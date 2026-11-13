/* Declarations for compiled JavaScript that calls the reactc thread runtime
 * (src/reactc-threads.c) through Porffor's inline C. */
#ifndef REACTC_THREADS_H
#define REACTC_THREADS_H
int reactc_thread_start(int entry, const char *data);
int reactc_thread_id(void);
const char *reactc_thread_data(void);
int reactc_thread_status(int id);
void reactc_thread_exit(int code) __attribute__((noreturn));
#endif
