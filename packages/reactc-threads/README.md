# @reactc/threads

Java-style threads for programs compiled with reactc. Threads share one heap:
every object, array, `Map`, `Set` and closure is the same object on every
thread, and the threads run in parallel on separate CPU cores.

```js
import { Thread, spawn, parallel, synchronized } from '@reactc/threads';
```

Importing it is all it takes. reactc sees the import and builds the program
with the shared heap. It works in server builds, for Windows (`--target
windows`) and Linux (`--target host`).

## Java style

```js
class Downloader extends Thread {
  constructor(url) { super(); this.url = url; }
  run() { return work(this.url); }      // runs on its own OS thread
}

const job = new Downloader('a').start();
const result = job.join();              // waits; returns run()'s result
```

You can also pass a task: `new Thread(() => work('a')).start()`.

## Functional style

```js
const count = spawn(countPrimes, 0, 500000).join();               // one thread
const parts = parallel([0, 1, 2, 3], index => countPart(index));  // one thread per item, results in order
```

## Async threads and threads as promises

`run()` can be `async`. Each thread runs its own event loop, so its awaits,
timers, promise chains and I/O (for example `node:fs/promises`) finish on
that thread. A thread is also a promise that runs on its own core:

```js
class Fetcher extends Thread {
  async run() {
    const text = await readFile(this.path, 'utf8');   // on this thread's loop
    await sleep(10);
    return parse(text);
  }
}

const one = await spawn(async n => { await sleep(5); return n * 2; }, 21);   // 42
const both = await Promise.all([new Fetcher('a.json'), new Fetcher('b.json')]);
await spawn(risky).catch(error => console.error(error));
const first = await Promise.race([spawn(slow), spawn(fast)]);
```

- `await thread`, `.then/.catch/.finally`, `Promise.all`/`race`, and returning
  a thread from an async function wait without blocking the caller's event
  loop. Awaiting a thread that was created but not started starts it.
- `join()` blocks and returns the settled value (or throws the rejection).
  `joinAsync()` and `parallelAsync()` are the non-blocking forms.
- A thread finishes when its loop has nothing left. A timer it does not await
  still runs first, as a Node program would. If `run()`'s promise can never
  settle, `join()` throws.

## Sharing and locks

Threads read and change the same objects directly. Use `synchronized` like
Java's `synchronized (lock) { ... }` when several threads update one thing:

```js
const totals = new Map();
parallel(files, file => {
  const n = countWords(file);
  synchronized(totals, () => totals.set(file, n));
});
```

- Any object can be the lock, and a thread can enter the same lock again.
- Without a lock, concurrent writes are races, as in Java. Updates such as
  `x.count++` can be lost, but the program cannot crash or corrupt an object.
  reactc locks structural changes (adding properties, growing arrays, `Map` and
  `Set` updates) itself.

## API

| | |
| --- | --- |
| `new Thread(task?)` | A thread. Subclass it and override `run()`, or pass `task`. |
| `thread.start()` | Starts `run()` on a new OS thread; returns the thread. |
| `thread.join()` | Waits (blocking); returns `run()`'s result or resolved value, or throws what it threw or rejected with. |
| `await thread` / `thread.then()` | The same without blocking; a thread is a promise. Starts an unstarted thread. |
| `thread.joinAsync()` | Promise for the result; keeps the caller's event loop running. |
| `thread.isDone()` | True once the thread has finished. |
| `spawn(fn, ...args)` | `new Thread(() => fn(...args)).start()`. |
| `parallel(items, fn)` | `fn(item, index)` on one thread per item; returns the results in order (blocking). |
| `parallelAsync(items, fn)` | The same as a promise. |
| `synchronized(lock, fn)` | Runs `fn` holding `lock`'s monitor; returns its result. |
| `currentThreadId()` | 0 on the main thread, then 1, 2, … |
| `collections()` | Stop-the-world garbage collections since threads started. |

TypeScript types are in `src/index.d.ts`.

## Limits

- **Blocking join.** `join()` blocks the calling thread; use `await` or
  `joinAsync()` in code that must keep serving.
- **Polling.** Awaiting a thread polls its state about every millisecond (one
  timer tick, about 15.6 ms on Windows).
- **Thread count.** At most 63 threads running or finished but not yet joined (or awaited) at once. Joined threads free their slot for the next one.
- **No mixing.** It cannot be combined with `worker_threads` or
  `child_process.fork` in one program. Those stay available with copied
  messages.
- **Coarse locks.** Structural changes share one lock, and monitors are striped
  over 256 locks, so heavy pushing and property adding from many threads
  serialises.
- **x86-64 only** for now.
- **reactc only.** It runs only in reactc-compiled programs, not under Node.

The design is described in [poc/shared-heap](../../poc/shared-heap/README.md),
and the runtime is `src/reactc-shared-heap`.
