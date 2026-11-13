/** A thread, as in Java: subclass it and override run(), or pass a task. It is
 * also a promise: `await thread` waits for run() without blocking (and starts
 * the thread if it was not started). */
export class Thread<T = unknown> implements PromiseLike<T> {
  then<R1 = T, R2 = never>(onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2>;
  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T | R>;
  finally(onFinally?: (() => void) | null): Promise<T>;
  constructor(task?: () => T | Promise<T>);
  /** 0 until started; then the thread's id. */
  readonly id: number;
  readonly started: boolean;
  /** The thread's work. Its return value (or an async run()'s resolved value) is what join() returns. */
  run(): T | Promise<T>;
  /** Starts run() on a new OS thread. */
  start(): this;
  /** Waits (blocking) and returns run()'s result; rethrows what run() threw or rejected with. */
  join(): T;
  /** Waits without blocking the caller's event loop. */
  joinAsync(pollMs?: number): Promise<T>;
  /** True once the thread has finished. */
  isDone(): boolean;
}

/** Runs fn(...args) on a new thread and returns the started Thread. */
export function spawn<A extends unknown[], T>(fn: (...args: A) => T | Promise<T>, ...args: A): Thread<T>;

/** Runs fn(item, index) for every item, one thread each; results in order. */
export function parallel<I, T>(items: readonly I[], fn: (item: I, index: number) => T | Promise<T>): T[];

/** Like parallel(), but returns a promise and keeps the caller's event loop running. */
export function parallelAsync<I, T>(items: readonly I[], fn: (item: I, index: number) => T | Promise<T>): Promise<T[]>;

/** Holds the monitor of `lock` while fn runs, like Java's synchronized block. */
export function synchronized<T>(lock: object, fn: () => T): T;

/** The calling thread's id: 0 on the main thread. */
export function currentThreadId(): number;

/** Stop-the-world collections since threads started. */
export function collections(): number;

declare const threads: {
  Thread: typeof Thread;
  spawn: typeof spawn;
  parallel: typeof parallel;
  parallelAsync: typeof parallelAsync;
  synchronized: typeof synchronized;
  currentThreadId: typeof currentThreadId;
  collections: typeof collections;
};
export default threads;
