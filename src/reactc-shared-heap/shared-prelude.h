/* Shared-heap threads (proof of concept): declarations injected at the top
 * of a Porffor program by poc/shared-heap/transform.mjs. Every thread runs the
 * same compiled program in one arena; see shared-runtime.c. */
#include <stdint.h>
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#else
#include <pthread.h>
#endif

/* Set while a collection wants every other thread stopped. */
static volatile int porf_stw_requested = 0;
static void porf_shared_park(void);
#define PORF_SAFEPOINT() do { if (__builtin_expect(porf_stw_requested, 0)) porf_shared_park(); } while (0)

/* Offset of this thread's copies of Porffor's static scratch arrays. */
static __thread unsigned int porf_ts_delta = 0;
#define PORF_TS(x) ((unsigned int)(x) + porf_ts_delta)

static void porf_shared_heap_lock(void);
static void porf_shared_heap_unlock(void);
static void porf_shared_stw_begin(void);
static void porf_shared_stw_end(void);
static void porf_shared_mark_threads(void);
static void porf_shared_clear_builders(void);
static void porf_shared_struct_lock(void);
static void porf_shared_struct_unlock(void);
static void porf_shared_try_note(int depth);
static void porf_shared_try_unwind(int depth);
static void porf_shared_safe_enter(void);
static void porf_shared_safe_leave(void);
static int porf_shared_callback_enter(void);
static void porf_shared_callback_exit(int entered);
