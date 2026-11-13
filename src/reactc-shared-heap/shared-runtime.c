/* Shared-heap threads (proof of concept), appended to a transformed Porffor
 * program. Every thread runs the same program in one arena, so any JS value
 * is visible to every thread, as in Java.
 *
 * - Each thread allocates from its own windows (porf_gc_active is
 *   thread-local); refilling a window and collecting take the heap lock.
 * - A collection stops the world: threads stop at safepoints (loop heads in
 *   compiled code and the allocator's slow path) or are already in a safe
 *   region (blocked on a lock, a join or the heap lock). A stopped thread has
 *   saved its registers and stack pointer and published its windows, and the
 *   collector scans every thread's stack conservatively. Porffor's GC never
 *   moves objects, so no pointer needs updating.
 * - Structural changes (adding properties, growing arrays, Map/Set updates)
 *   take one recursive structure lock, so concurrent changes cannot corrupt
 *   an object's storage. Plain property value writes are unlocked races, as
 *   in Java.
 *
 * - Each thread has its own event loop: timers, promise jobs and (when linked)
 *   a libuv loop. After run() returns, the thread runs its loop until it has
 *   nothing left to do, so async run() functions and their awaits complete
 *   on that thread. Waiting for timers or I/O is a safe region. */
#include <setjmp.h>

enum { PORF_THREAD_MAX = 64 };
enum { PORF_T_FREE, PORF_T_STARTING, PORF_T_RUNNING, PORF_T_STOPPED, PORF_T_DONE };

struct porf_thread {
  int state;
  int failed;
  jsval fn, result;
  jmp_buf regs;          /* registers when stopped */
  void *sp, *top;        /* stack range to scan when stopped */
  unsigned int delta;    /* scratch copy offset */
#ifdef _WIN32
  HANDLE handle;
#else
  pthread_t handle;
#endif
  PORF_TLS_FIELDS
};

static struct porf_thread porf_threads[PORF_THREAD_MAX];
static __thread int porf_self = -1;       /* registry index; -1 before registration */
static int porf_thread_count = 0;          /* slots handed out */
static int porf_running = 0;               /* registered threads in RUNNING */
static long porf_gc_stw_count = 0;

#ifdef _WIN32
typedef CRITICAL_SECTION porf_mutex;
typedef CONDITION_VARIABLE porf_cond;
static void porf_mutex_init(porf_mutex *m) { InitializeCriticalSection(m); }
static void porf_mutex_lock(porf_mutex *m) { EnterCriticalSection(m); }
static int porf_mutex_trylock(porf_mutex *m) { return TryEnterCriticalSection(m) != 0; }
static void porf_mutex_unlock(porf_mutex *m) { LeaveCriticalSection(m); }
static void porf_cond_init(porf_cond *c) { InitializeConditionVariable(c); }
static void porf_cond_wait(porf_cond *c, porf_mutex *m) { SleepConditionVariableCS(c, m, INFINITE); }
static void porf_cond_broadcast(porf_cond *c) { WakeAllConditionVariable(c); }
#else
typedef pthread_mutex_t porf_mutex;
typedef pthread_cond_t porf_cond;
static void porf_mutex_init(porf_mutex *m) { pthread_mutex_init(m, NULL); }
static void porf_mutex_lock(porf_mutex *m) { pthread_mutex_lock(m); }
static int porf_mutex_trylock(porf_mutex *m) { return pthread_mutex_trylock(m) == 0; }
static void porf_mutex_unlock(porf_mutex *m) { pthread_mutex_unlock(m); }
static void porf_cond_init(porf_cond *c) { pthread_cond_init(c, NULL); }
static void porf_cond_wait(porf_cond *c, porf_mutex *m) { pthread_cond_wait(c, m); }
static void porf_cond_broadcast(porf_cond *c) { pthread_cond_broadcast(c); }
#endif

/* REACTC_SHARED_TRACE=1 logs thread starts, joins, safe regions and
   collections to stderr. */
static int porf_trace_on = -1;
#define PORF_TRACE(...) do { \
  if (porf_trace_on < 0) porf_trace_on = getenv("REACTC_SHARED_TRACE") != NULL; \
  if (porf_trace_on) { fprintf(stderr, "[reactc thread %d] ", porf_self); fprintf(stderr, __VA_ARGS__); fputc('\n', stderr); } \
} while (0)

static porf_mutex porf_world;     /* registry, states and stop-the-world */
static porf_cond porf_world_changed;
static int porf_world_ready = 0;

static void porf_shared_bind_tls(struct porf_thread *t);
static void porf_shared_mark_tls(struct porf_thread *t);

static void porf_world_init(void) {
  if (porf_world_ready) return;
  porf_world_ready = 1;
  porf_mutex_init(&porf_world);
  porf_cond_init(&porf_world_changed);
}

/* Publishes and drops this thread's allocation windows; the collector resets
   its own the same way after a collection. */
static void porf_shared_drop_windows(void) {
  for (i32 ci = 0; ci < PORF_GC_NCLASSES; ci++) porf_gc_publish_window(ci);
  memset(porf_gc_active, 0, sizeof(porf_gc_active));
}

/* Called with the world lock held: records where this thread's roots are. */
static void porf_shared_save(struct porf_thread *t, void *sp) {
  t->sp = sp;
  porf_shared_drop_windows();
}

/* A thread at a safepoint stops until the collection is over. */
static PORF_NOINLINE void porf_shared_park(void) {
  if (porf_self < 0) return;
  struct porf_thread *t = &porf_threads[porf_self];
  PORF_TRACE("park (running=%d)", porf_running);
  porf_mutex_lock(&porf_world);
  if (porf_stw_requested && t->state == PORF_T_RUNNING) {
    volatile int anchor = 0;
    _setjmp(t->regs);
    porf_shared_save(t, (void *)&anchor);
    t->state = PORF_T_STOPPED;
    porf_running--;
    porf_cond_broadcast(&porf_world_changed);
    while (porf_stw_requested) porf_cond_wait(&porf_world_changed, &porf_world);
    t->state = PORF_T_RUNNING;
    porf_running++;
    (void)anchor;
  }
  porf_mutex_unlock(&porf_world);
}

/* Around anything that may block, the thread counts as stopped. The caller's
   frames are above the recorded stack pointer, and their callee-saved
   registers are in t->regs. */
static __thread int porf_safe_active = 0;   /* inside safe_enter .. safe_leave */

static PORF_NOINLINE void porf_shared_safe_enter(void) {
  if (porf_self < 0) return;
  porf_safe_active = 1;
  struct porf_thread *t = &porf_threads[porf_self];
  PORF_TRACE("safe enter (running=%d)", porf_running);
  porf_mutex_lock(&porf_world);
  volatile int anchor = 0;
  _setjmp(t->regs);
  porf_shared_save(t, (void *)&anchor);
  t->state = PORF_T_STOPPED;
  porf_running--;
  porf_cond_broadcast(&porf_world_changed);
  porf_mutex_unlock(&porf_world);
  (void)anchor;
}

/* Only undoes an enter that took effect: a thread that registered while
   inside a wait (the first thread started from a request handler) must not be
   counted as running twice. */
static void porf_shared_safe_leave(void) {
  if (porf_self < 0 || !porf_safe_active) return;
  porf_safe_active = 0;
  struct porf_thread *t = &porf_threads[porf_self];
  PORF_TRACE("safe leave (running=%d, stw=%d)", porf_running, porf_stw_requested);
  porf_mutex_lock(&porf_world);
  while (porf_stw_requested) porf_cond_wait(&porf_world_changed, &porf_world);
  t->state = PORF_T_RUNNING;
  porf_running++;
  porf_mutex_unlock(&porf_world);
}

/* C callbacks that call into JavaScript from inside a safe region (the uWS
   bridge runs request handlers from uv_run) leave it for the call. */
static int porf_shared_callback_enter(void) {
  if (porf_self < 0 || !porf_safe_active) return 0;
  porf_shared_safe_leave();
  return 1;
}
static void porf_shared_callback_exit(int entered) {
  if (entered) porf_shared_safe_enter();
}

/* Recursive locks whose waits are safe regions. */
struct porf_rlock { porf_mutex m; volatile int owner; int depth; int ready; };

static void porf_rlock_acquire(struct porf_rlock *l) {
  const int me = porf_self + 2;   /* 1 is "before registration" (main thread) */
  const int self = porf_self < 0 ? 1 : me;
  if (l->owner == self) { l->depth++; return; }
  if (!porf_mutex_trylock(&l->m)) {
    porf_shared_safe_enter();
    porf_mutex_lock(&l->m);
    porf_shared_safe_leave();
  }
  l->owner = self;
  l->depth = 1;
}

static void porf_rlock_release(struct porf_rlock *l) {
  if (--l->depth == 0) {
    l->owner = 0;
    porf_mutex_unlock(&l->m);
  }
}

static struct porf_rlock porf_heap_rlock, porf_struct_rlock;
static __thread int porf_struct_depth = 0;
static __thread int *porf_try_locks = NULL;
static __thread int porf_try_locks_cap = 0;

static void porf_locks_init(void) {
  static int ready = 0;
  if (ready) return;
  ready = 1;
  porf_world_init();
  porf_mutex_init(&porf_heap_rlock.m);
  porf_mutex_init(&porf_struct_rlock.m);
}

static void porf_shared_heap_lock(void) {
  if (!porf_thread_count) return;   /* single-threaded until a thread starts */
  porf_rlock_acquire(&porf_heap_rlock);
}
static void porf_shared_heap_unlock(void) {
  if (!porf_thread_count) return;
  porf_rlock_release(&porf_heap_rlock);
}

static void porf_shared_struct_lock(void) {
  if (!porf_thread_count) return;
  porf_rlock_acquire(&porf_struct_rlock);
  porf_struct_depth++;
}
static void porf_shared_struct_unlock(void) {
  if (!porf_thread_count || porf_struct_depth == 0) return;
  porf_struct_depth--;
  porf_rlock_release(&porf_struct_rlock);
}

/* A throw out of a locked builtin releases what it took since the try. */
static void porf_shared_try_note(int depth) {
  if (depth >= porf_try_locks_cap) {
    int cap = porf_try_locks_cap ? porf_try_locks_cap : 8;
    while (depth >= cap) cap <<= 1;
    porf_try_locks = (int *)realloc(porf_try_locks, (size_t)cap * sizeof(int));
    if (!porf_try_locks) abort();
    porf_try_locks_cap = cap;
  }
  porf_try_locks[depth] = porf_struct_depth;
}
static void porf_shared_try_unwind(int depth) {
  if (depth < 0 || depth >= porf_try_locks_cap) return;
  while (porf_struct_depth > porf_try_locks[depth]) porf_shared_struct_unlock();
}

/* The collecting thread holds the heap lock and waits for every other
   registered thread to stop. */
static void porf_shared_stw_begin(void) {
  if (!porf_thread_count) return;
  porf_shared_heap_lock();
  porf_mutex_lock(&porf_world);
  porf_stw_requested = 1;
  PORF_TRACE("stop the world (running=%d)", porf_running);
  const int counted = porf_self >= 0 && porf_threads[porf_self].state == PORF_T_RUNNING;
  if (counted) porf_running--;
  while (porf_running > 0) porf_cond_wait(&porf_world_changed, &porf_world);
  if (counted) porf_running++;
  porf_gc_stw_count++;
  PORF_TRACE("world stopped");
  /* the world lock stays held: no thread starts, stops or leaves mid-collection */
}

static void porf_shared_stw_end(void) {
  if (!porf_thread_count) return;
  porf_stw_requested = 0;
  porf_cond_broadcast(&porf_world_changed);
  porf_mutex_unlock(&porf_world);
  porf_shared_heap_unlock();
}

/* Roots of every other thread: its stack, saved registers, try buffers and
   thread-local runtime state, plus each thread's function and result. */
static void porf_shared_mark_threads(void) {
  for (int i = 0; i < porf_thread_count; i++) {
    struct porf_thread *t = &porf_threads[i];
    if (t->state == PORF_T_FREE) continue;
    porf_gc_mark_js(t->fn.val, t->fn.type);
    porf_gc_mark_js(t->result.val, t->result.type);
    if (i == porf_self || t->state != PORF_T_STOPPED) continue;
    porf_gc_cons_scan_range((const u64 *)&t->regs, (const u64 *)((const char *)&t->regs + sizeof(t->regs)));
    const u64 *lo = (const u64 *)(((uintptr_t)t->sp + 7) & ~(uintptr_t)7);
    if ((const void *)lo < t->top) porf_gc_cons_scan_range(lo, (const u64 *)t->top);
    porf_shared_mark_tls(t);
  }
  porf_gc_drain_mark_queue();
}

/* String builders are not roots; every thread rebuilds after a collection. */
static void porf_shared_clear_builders(void) {
  for (int i = 0; i < porf_thread_count; i++) {
    struct porf_thread *t = &porf_threads[i];
    if (i != porf_self && t->state == PORF_T_STOPPED) memset(*t->r_porf_str_builder_caps, 0, sizeof(*t->r_porf_str_builder_caps));
  }
}

/* Registers the calling thread; `top` is the highest address of its stack
   that holds JS values. Called with the world lock held. */
static void porf_shared_register(int index, void *top) {
  struct porf_thread *t = &porf_threads[index];
  porf_self = index;
  t->top = top;
  porf_ts_delta = t->delta;
  porf_shared_bind_tls(t);
  t->state = PORF_T_RUNNING;
  porf_running++;
}

static void porf_shared_register_main(void) {
  if (porf_self >= 0) return;
  /* only the main thread exists yet: build every lazily created builtin */
  porf_shared_init_builtins();
  porf_locks_init();
  porf_mutex_lock(&porf_world);
  const int index = porf_thread_count++;
  porf_threads[index].delta = 0;
  porf_shared_register(index, porf_c_stack_top);
  porf_mutex_unlock(&porf_world);
}

static void porf_shared_run(int index) {
  volatile int anchor = 0;
  porf_mutex_lock(&porf_world);
  while (porf_stw_requested) porf_cond_wait(&porf_world_changed, &porf_world);
  porf_shared_register(index, (void *)&anchor);
  porf_c_stack_top = (void *)&anchor;
  porf_mutex_unlock(&porf_world);
  /* this thread's copy of the static scratch arrays */
  memcpy(MEM + PORF_TS_LO + porf_ts_delta, MEM + PORF_TS_LO, PORF_TS_SIZE);
  /* its own timers, promise rejection tracking and libuv loop */
  porf_shared_thread_init();

  struct porf_thread *t = &porf_threads[index];
  porf_try_depth++;
  porf_shared_try_note(porf_try_depth - 1);
  if (_setjmp(porf_try_ensure()[porf_try_depth - 1]) == 0) {
    t->result = porf_call_dynamic(t->fn, porf_box(0.0, 0), JV_UNDEFINED, 0, NULL);
    /* timers, awaits and I/O started by run() finish on this thread */
    porf_shared_thread_loop();
    porf_try_depth--;
  } else {
    porf_try_depth--;
    t->failed = 1;
    t->result = porf_exception;
  }
  porf_mutex_lock(&porf_world);
  PORF_TRACE("done (failed=%d)", t->failed);
  porf_shared_drop_windows();
  t->state = PORF_T_DONE;
  porf_running--;
  porf_cond_broadcast(&porf_world_changed);
  porf_mutex_unlock(&porf_world);
  (void)anchor;
}

#ifdef _WIN32
static unsigned __stdcall porf_shared_main(void *argument) { porf_shared_run((int)(intptr_t)argument); return 0; }
#else
static void *porf_shared_main(void *argument) { porf_shared_run((int)(intptr_t)argument); return NULL; }
#endif

/* Starts `fn` on a new thread in this arena; returns its id. */
static int porf_shared_start(jsval fn) {
  porf_shared_register_main();
  porf_mutex_lock(&porf_world);
  while (porf_stw_requested) porf_cond_wait(&porf_world_changed, &porf_world);
  /* a joined thread's slot is reused; at most PORF_THREAD_MAX - 1 threads
     are started and not yet joined at once */
  int index = 0;
  for (int i = 1; i < porf_thread_count; i++) if (porf_threads[i].state == PORF_T_FREE) { index = i; break; }
  if (!index) {
    if (porf_thread_count >= PORF_THREAD_MAX) { porf_mutex_unlock(&porf_world); return -1; }
    index = porf_thread_count++;
  }
  struct porf_thread *t = &porf_threads[index];
  PORF_TRACE("start thread %d", index);
  t->state = PORF_T_STARTING;
  t->failed = 0;
  t->fn = fn;
  t->result = JV_UNDEFINED;
  t->delta = PORF_TS_ZONE + (unsigned int)(index - 1) * PORF_TS_SIZE - PORF_TS_LO;
  porf_mutex_unlock(&porf_world);
#ifdef _WIN32
  t->handle = (HANDLE)_beginthreadex(NULL, 64u << 20, porf_shared_main, (void *)(intptr_t)index, 0, NULL);
  if (!t->handle) abort();
#else
  pthread_attr_t attributes;
  pthread_attr_init(&attributes);
  pthread_attr_setstacksize(&attributes, 64u << 20);
  if (pthread_create(&t->handle, &attributes, porf_shared_main, (void *)(intptr_t)index)) abort();
  pthread_attr_destroy(&attributes);
#endif
  return index;
}

/* Waits for thread `id`, frees its slot for reuse and returns its result, or
   rethrows what it threw. Each started thread is joined once (the library
   keeps the outcome for later join() calls). */
static jsval porf_shared_join(jsval idValue) {
  const int id = (int)idValue.val;
  if (id <= 0 || id >= porf_thread_count) porf_throw(porf_box(0.0, 0));
  struct porf_thread *t = &porf_threads[id];
  if (t->state == PORF_T_FREE) porf_throw(porf_box(0.0, 0));
  PORF_TRACE("join thread %d", id);
  porf_shared_safe_enter();
  porf_mutex_lock(&porf_world);
  while (t->state != PORF_T_DONE) porf_cond_wait(&porf_world_changed, &porf_world);
  porf_mutex_unlock(&porf_world);
  /* the OS thread is past its last access to the slot */
#ifdef _WIN32
  WaitForSingleObject(t->handle, INFINITE);
  CloseHandle(t->handle);
  t->handle = NULL;
#else
  pthread_join(t->handle, NULL);
#endif
  porf_shared_safe_leave();
  const int failed = t->failed;
  const jsval result = t->result;   /* rooted from this frame once the slot lets go */
  porf_mutex_lock(&porf_world);
  t->fn = JV_UNDEFINED;
  t->result = JV_UNDEFINED;
  t->state = PORF_T_FREE;
  porf_mutex_unlock(&porf_world);
  if (failed) porf_throw(result);
  return result;
}

static int porf_shared_self_id(void) { return porf_self < 0 ? 0 : porf_self; }

/* 1 once thread `id` has finished (join will not block). */
static int porf_shared_done(jsval idValue) {
  const int id = (int)idValue.val;
  if (id <= 0 || id >= porf_thread_count) return 1;
  porf_mutex_lock(&porf_world);
  const int done = porf_threads[id].state == PORF_T_DONE;
  porf_mutex_unlock(&porf_world);
  return done;
}

#ifdef UV_VERSION_MAJOR
/* The main thread keeps libuv's default loop; every other thread gets its own.
   A thread's loop is not freed: the shared thread pool may still post to it. */
static uv_loop_t *porf_shared_uv_loop(void) {
  if (porf_self <= 0) return uv_default_loop();
  uv_loop_t *loop = (uv_loop_t *)malloc(sizeof *loop);
  if (!loop || uv_loop_init(loop)) abort();
  return loop;
}
#endif

/* Java-style monitors on any object: its offset never changes, so it keys a
   striped table of recursive locks. */
enum { PORF_MONITORS = 256 };
static struct porf_rlock porf_monitors[PORF_MONITORS];
static struct porf_rlock *porf_monitor_for(jsval obj) {
  const u32 key = (u32)obj.val;
  struct porf_rlock *l = &porf_monitors[(key >> 4) * 2654435761u % PORF_MONITORS];
  if (!l->ready) {
    porf_mutex_lock(&porf_world);
    if (!l->ready) { porf_mutex_init(&l->m); l->ready = 1; }
    porf_mutex_unlock(&porf_world);
  }
  return l;
}
static void porf_shared_monitor_enter(jsval obj) { porf_shared_register_main(); porf_rlock_acquire(porf_monitor_for(obj)); }
static void porf_shared_monitor_exit(jsval obj) { porf_rlock_release(porf_monitor_for(obj)); }
