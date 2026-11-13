// @reactc/threads: Java-style threads for reactc programs. Threads share one
// heap, so every object, array, Map, Set and closure is the same object on
// every thread, and they run in parallel on separate cores.
//
// Importing this module makes reactc build the program with the shared heap
// (see src/reactc-shared-heap). It runs only in reactc-compiled programs; the
// native parts below are Porffor inline C.

function nativeStart(fn) {
  let id = 0;
  Porffor.c`id = (f64)porf_shared_start(fn);`;
  return id;
}

function nativeJoin(id) {
  let out = null;
  Porffor.c`out = porf_shared_join(id);`;
  return out;
}

function nativeLock(lock) {
  Porffor.c`porf_shared_monitor_enter(lock);`;
}

function nativeUnlock(lock) {
  Porffor.c`porf_shared_monitor_exit(lock);`;
}

function nativeDone(id) {
  let done = 0;
  Porffor.c`done = (f64)porf_shared_done(id);`;
  return done;
}

function nativeThreadId() {
  let id = 0;
  Porffor.c`id = (f64)porf_shared_self_id();`;
  return id;
}

function nativeCollections() {
  let count = 0;
  Porffor.c`count = (f64)porf_gc_stw_count;`;
  return count;
}

// Compiled by reactc, the native helpers above work. Under plain Node (for
// example `npm run dev:server`), Porffor.c is not defined and they throw:
// threads then run on the calling thread, with a warning, so code can still be
// developed under Node. Compiled programs always use real threads.
const compiled = (() => {
  try { nativeThreadId(); return true; } catch { return false; }
})();
let warned = false;
function warnUnderNode() {
  if (warned) return;
  warned = true;
  console.warn('@reactc/threads: not compiled by reactc, so threads run on the calling thread (no parallelism). Build with reactc for real threads.');
}

// What a thread hands back: run()'s value, or the outcome of the promise an
// async run() returned. The thread runs its own event loop until nothing is
// left, so awaits, timers and I/O started in run() finish on that thread.
function settle(value) {
  const outcome = { state: 1, value };
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function') {
    outcome.state = 0;
    value.then(result => { outcome.state = 1; outcome.value = result; },
      error => { outcome.state = 2; outcome.value = error; });
  }
  return outcome;
}

function unwrap(outcome) {
  if (outcome.state === 2) throw outcome.value;
  if (outcome.state === 0) throw new Error('the thread finished with its promise still pending (nothing left that could settle it)');
  return outcome.value;
}

/** A thread, as in Java: subclass it and override run(), or pass a task. */
export class Thread {
  constructor(task) {
    this.task = typeof task === 'function' ? task : null;
    this.id = 0;
    this.started = false;
  }

  /** The thread's work. Its return value (or, for an async run(), what its
   * promise resolves to) is what join() returns. */
  run() {
    return this.task ? this.task() : undefined;
  }

  /** Starts run() on a new OS thread. Returns this thread. */
  start() {
    if (this.started) throw new Error('Thread already started');
    this.started = true;
    if (!compiled) {
      warnUnderNode();
      try { this.outcome = settle(this.run()); } catch (error) { this.outcome = { state: 2, value: error }; }
      return this;
    }
    this.id = nativeStart(() => settle(this.run()));
    if (this.id < 0) throw new Error('too many threads: at most 63 may run or wait to be joined at once');
    return this;
  }

  /** Waits for the thread to finish and returns run()'s result. If run()
   * threw or its promise rejected, join() throws the same error. Blocks the
   * calling thread. */
  join() {
    if (!this.started) throw new Error('Thread not started');
    if (!compiled) {
      if (this.outcome.state === 0) throw new Error('under Node, join() cannot wait for an async run(); use await thread');
      return unwrap(this.outcome);
    }
    // The native join frees the thread's slot for reuse, so it runs once; the
    // outcome is kept for later join(), await and isDone() calls.
    if (!this.joined) {
      try {
        this.outcome = nativeJoin(this.id);
      } catch (error) {
        this.outcome = { state: 2, value: error };
      }
      this.joined = true;
    }
    return unwrap(this.outcome);
  }

  /** Like join(), but returns a promise and keeps the caller's event loop
   * running while it waits. */
  joinAsync(pollMs = 1) {
    if (!this.started) return Promise.reject(new Error('Thread not started'));
    if (!compiled) {
      const outcome = this.outcome;
      if (outcome.state !== 0) return outcome.state === 2 ? Promise.reject(outcome.value) : Promise.resolve(outcome.value);
      return new Promise((resolve, reject) => {
        const check = () => {
          if (outcome.state === 0) { setTimeout(check, pollMs); return; }
          if (outcome.state === 2) reject(outcome.value); else resolve(outcome.value);
        };
        check();
      });
    }
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!this.joined && !nativeDone(this.id)) { setTimeout(check, pollMs); return; }
        try { resolve(this.join()); } catch (error) { reject(error); }
      };
      check();
    });
  }

  /** True once the thread has finished. */
  isDone() {
    if (!compiled) return this.started && this.outcome.state !== 0;
    return this.started && (this.joined === true || nativeDone(this.id) === 1);
  }

  // A thread is a promise that runs on its own core: `await thread`,
  // Promise.all(threads), .then/.catch/.finally, or returning it from an async
  // function all wait for run() without blocking the caller's event loop.
  // Awaiting a thread that was created but not started starts it.
  then(onFulfilled, onRejected) {
    if (!this.started) this.start();
    if (!this.promise) this.promise = this.joinAsync();
    return this.promise.then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.then(undefined, onRejected);
  }

  finally(onFinally) {
    return this.then(value => { onFinally(); return value; }, error => { onFinally(); throw error; });
  }
}

/** Runs fn(...args) on a new thread and returns the started Thread. */
export function spawn(fn, ...args) {
  return new Thread(() => fn(...args)).start();
}

/** Like parallel(), but returns a promise and keeps the caller's event loop
 * running while the threads work. */
export function parallelAsync(items, fn) {
  const threads = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const index = i;
    threads.push(spawn(fn, item, index));
  }
  return Promise.all(threads);
}

/** Runs fn(item, index) for every item, one thread each, and returns the
 * results in order. */
export function parallel(items, fn) {
  const threads = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const index = i;
    threads.push(spawn(fn, item, index));
  }
  return threads.map(thread => thread.join());
}

/** Holds the monitor of `lock` (any object) while fn runs, like Java's
 * synchronized (lock) { ... }. The same thread may enter it again. */
export function synchronized(lock, fn) {
  if (!compiled) return fn();
  nativeLock(lock);
  try {
    return fn();
  } finally {
    nativeUnlock(lock);
  }
}

/** The calling thread's id: 0 on the main thread. */
export function currentThreadId() {
  return compiled ? nativeThreadId() : 0;
}

/** How many stop-the-world collections have run since threads started. */
export function collections() {
  return compiled ? nativeCollections() : 0;
}

export default { Thread, spawn, parallel, parallelAsync, synchronized, currentThreadId, collections };
