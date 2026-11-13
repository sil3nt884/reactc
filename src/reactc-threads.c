/* reactc thread runtime: runs compiled worker programs on OS threads.
 *
 * Each worker is a separate Porffor program linked into the same executable
 * with its symbols made local, so it has its own globals, heap and libuv loop.
 * The build includes this file after defining REACTC_WORKER_COUNT and
 * reactc_worker_entries[]. Compiled JavaScript reaches it through the
 * reactc_thread_* functions declared in reactc-threads.h. */
#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <process.h>
typedef HANDLE reactc_thread_handle;
#else
#include <pthread.h>
typedef pthread_t reactc_thread_handle;
#endif
/* GCC (MinGW included) ignores __declspec(thread), which would leave the
   "thread-local" a single shared variable. */
#if defined(_MSC_VER) && !defined(__clang__)
#define REACTC_THREAD_LOCAL __declspec(thread)
#else
#define REACTC_THREAD_LOCAL __thread
#endif

enum { REACTC_THREAD_LIMIT = 256, REACTC_THREAD_STACK = 64 * 1024 * 1024 };

struct reactc_thread_slot {
  reactc_thread_handle handle;
  int entry;
  char *data;
  volatile long state;   /* 0 free, 1 running, 2 exited */
  volatile int exit_code;
  jmp_buf finish;        /* reactc_thread_exit returns here on the worker thread */
};

static struct reactc_thread_slot reactc_threads[REACTC_THREAD_LIMIT + 1];
static REACTC_THREAD_LOCAL int reactc_thread_current;  /* 0 on the main thread */
#ifdef _WIN32
static SRWLOCK reactc_thread_lock = SRWLOCK_INIT;
#define REACTC_LOCK() AcquireSRWLockExclusive(&reactc_thread_lock)
#define REACTC_UNLOCK() ReleaseSRWLockExclusive(&reactc_thread_lock)
#else
static pthread_mutex_t reactc_thread_lock = PTHREAD_MUTEX_INITIALIZER;
#define REACTC_LOCK() pthread_mutex_lock(&reactc_thread_lock)
#define REACTC_UNLOCK() pthread_mutex_unlock(&reactc_thread_lock)
#endif

/* REACTC_THREAD_TRACE=1 logs thread starts and ends, and on Linux prints a
 * backtrace when the process crashes. */
#include <stdio.h>
static int reactc_thread_tracing(void) {
  static int tracing = -1;
  if (tracing < 0) tracing = getenv("REACTC_THREAD_TRACE") != NULL;
  return tracing;
}
#if !defined(_WIN32) && defined(__GLIBC__)
#include <execinfo.h>
#include <signal.h>
#include <unistd.h>
static void reactc_thread_crash(int signal_number) {
  void *frames[64];
  int count = backtrace(frames, 64);
  fprintf(stderr, "reactc: signal %d on thread %d\n", signal_number, reactc_thread_current);
  backtrace_symbols_fd(frames, count, 2);
  _exit(128 + signal_number);
}
#endif
static void reactc_thread_trace_init(void) {
#if !defined(_WIN32) && defined(__GLIBC__)
  static int installed;
  if (reactc_thread_tracing() && !installed) {
    installed = 1;
    signal(SIGSEGV, reactc_thread_crash);
    signal(SIGBUS, reactc_thread_crash);
  }
#endif
}

static void reactc_thread_run(int id) {
  struct reactc_thread_slot *slot = &reactc_threads[id];
  reactc_thread_current = id;
  if (reactc_thread_tracing()) fprintf(stderr, "reactc: thread %d starts worker %d\n", id, slot->entry);
  static char name[] = "reactc-worker";
  char *argv[] = { name, NULL };
  int code;
  if (setjmp(slot->finish) == 0) code = reactc_worker_entries[slot->entry - 1](1, argv);
  else code = slot->exit_code;
  if (reactc_thread_tracing()) fprintf(stderr, "reactc: thread %d ends with %d\n", id, code);
  REACTC_LOCK();
  slot->exit_code = code;
  slot->state = 2;
  REACTC_UNLOCK();
}

#ifdef _WIN32
static unsigned __stdcall reactc_thread_main(void *argument) { reactc_thread_run((int)(intptr_t)argument); return 0; }
#else
static void *reactc_thread_main(void *argument) { reactc_thread_run((int)(intptr_t)argument); return NULL; }
#endif

/* Starts worker program `entry` (1-based) with UTF-8 `data`; returns its
 * thread id (1..), or 0 when it cannot start. */
int reactc_thread_start(int entry, const char *data) {
  reactc_thread_trace_init();
  if (reactc_thread_tracing()) fprintf(stderr, "reactc: start worker %d of %d\n", entry, REACTC_WORKER_COUNT);
  if (entry < 1 || entry > REACTC_WORKER_COUNT) return 0;
  REACTC_LOCK();
  int id = 0;
  for (int i = 1; i <= REACTC_THREAD_LIMIT; i++) {
    if (reactc_threads[i].state == 0 || reactc_threads[i].state == 3) { id = i; break; }
  }
  if (!id) { REACTC_UNLOCK(); return 0; }
  struct reactc_thread_slot *slot = &reactc_threads[id];
  free(slot->data);
  slot->data = strdup(data ? data : "");
  slot->entry = entry;
  slot->exit_code = 0;
  slot->state = 1;
  REACTC_UNLOCK();
#ifdef _WIN32
  uintptr_t handle = _beginthreadex(NULL, REACTC_THREAD_STACK, reactc_thread_main, (void *)(intptr_t)id, 0, NULL);
  if (!handle) { slot->state = 0; return 0; }
  slot->handle = (HANDLE)handle;
#else
  pthread_attr_t attributes;
  pthread_attr_init(&attributes);
  pthread_attr_setstacksize(&attributes, REACTC_THREAD_STACK);
  int failed = pthread_create(&slot->handle, &attributes, reactc_thread_main, (void *)(intptr_t)id);
  pthread_attr_destroy(&attributes);
  if (failed) { slot->state = 0; return 0; }
  pthread_detach(slot->handle);
#endif
  return id;
}

/* The calling thread's id: 0 on the main thread. */
int reactc_thread_id(void) { reactc_thread_trace_init(); return reactc_thread_current; }

/* The data the calling worker was started with, or "" on the main thread. */
const char *reactc_thread_data(void) {
  reactc_thread_trace_init();
  int id = reactc_thread_current;
  return id && reactc_threads[id].data ? reactc_threads[id].data : "";
}

/* -1 while thread `id` runs, else its exit code (and the slot is reusable). */
int reactc_thread_status(int id) {
  if (id < 1 || id > REACTC_THREAD_LIMIT) return 0;
  REACTC_LOCK();
  int state = reactc_threads[id].state, code = reactc_threads[id].exit_code;
  if (state == 2) {
#ifdef _WIN32
    if (reactc_threads[id].handle) { CloseHandle(reactc_threads[id].handle); reactc_threads[id].handle = NULL; }
#endif
    reactc_threads[id].state = 3;
  }
  REACTC_UNLOCK();
  return state == 1 ? -1 : code;
}

/* process.exit() in a worker ends that worker's thread only. */
void reactc_thread_exit(int code) {
  int id = reactc_thread_current;
  if (!id) exit(code);
  reactc_threads[id].exit_code = code;
  longjmp(reactc_threads[id].finish, 1);
}
