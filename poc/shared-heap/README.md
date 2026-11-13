# Shared-heap threads (proof of concept)

Ordinary JavaScript objects shared between OS threads that run truly in
parallel, the Java model: one heap, no global interpreter lock. Every thread
runs the same compiled program in one Porffor arena, so a class instance,
array, `Map`, `Set` or closure created on one thread is the same object on
every other thread.

It is now built into reactc as [`@reactc/threads`](../../packages/reactc-threads/README.md):
importing it builds the program with the shared heap. The runtime moved to
`src/reactc-shared-heap`. This folder keeps the design notes and the stress
tests.

## Try it

From Windows at the repository root:

```sh
node scripts/check-reactc-shared-threads.mjs --host --runs 20
```

It builds `examples/threads` and the tests here (`shared.js`, a 5× `stress`
variant, `textdebug.js`, `bench.js`) with reactc for Windows and Linux. It runs
each one repeatedly and fails on any wrong result, crash or hang.

## How it works

`src/reactc-shared-heap/transform.mjs` rewrites Porffor's C output, and
`shared-runtime.c` is appended to it.

- **Why it is possible.** Porffor's collector never moves objects, and it
  finds stack roots conservatively. An object's offset is valid on every
  thread, and the collector needs no stack maps. That is the design
  multi-threaded C collectors (Boehm) use.
- **Thread-local execution state.** The try stack, current exception,
  coroutine state, promise job queue, string builders, regex and JSON work
  buffers, and allocation windows become `__thread`. A registry keeps pointers
  to each thread's copies so the collector can mark them.
- **Per-thread scratch.** Porffor reuses fixed static arrays for call
  arguments. Each thread gets its own copy in a zone reserved below the heap,
  and compiled code addresses them through `PORF_TS()`.
- **Allocation.** Each thread bump-allocates in its own windows. Refilling a
  window takes the heap lock. Allocations are zeroed, so a collection never
  sees another thread's stale bytes.
- **Stop-the-world collection.** The collecting thread holds the heap lock and
  raises a flag. Other threads stop at safepoints: loop heads in compiled code
  and the allocator's slow path. A thread blocked on a lock, a join or the heap
  lock is in a safe region and counts as stopped. A stopping thread saves its
  registers and stack pointer and publishes its windows. The collector then
  scans every thread's stack, registers and thread-local roots.
- **Structural changes.** Adding or deleting properties, shape transitions,
  growing arrays, and `Map`/`Set` updates take one recursive structure lock,
  so two threads cannot corrupt an object's storage. A throw out of a locked
  builtin releases what it took. Writes to existing properties are unlocked
  races, as in Java: values can be lost, nothing can break.
- **Inline caches** stay shared. An own-property entry is one 32-bit word
  (shape and slot), so it cannot tear, and proto entries re-check the holder's
  shape.
- **Lazily built builtins.** Prototypes such as `RegExp.prototype` are built
  on first use, and the pointer is published before the properties. All of
  them are built when the first thread starts.
- **Monitors.** `synchronized(obj, fn)` locks a recursive monitor keyed by the
  object's offset, which never changes. Waiting is a safe region.

## Results

The proof of concept's check, `--runs 20`, on 2026-11-13 (x86-64, 20 cores), every run correct on
both platforms:

| Test | Linux | Windows exe |
| --- | --- | --- |
| `shared` (20k rounds per thread, 5 threads, ~42 collections) | 20/20 | 20/20 |
| `stress` (100k rounds per thread, ~97 collections) | 5/5 | 5/5 |
| `textdebug` (JSON + regex in every thread) | 20/20 | 20/20 |
| `bench` (CPU-bound, 1 thread vs 4) | 3.85× | 3.82× |

Each test checks exact counts and identities after five threads (main plus
four) changed one object graph: an object (including properties added by
threads), an array, a `Map`, a `Set`, objects created on one thread and read
on another, and an exception thrown on a thread and caught by `join()`. About
3% of the deliberately unsynchronised `shared.racy++` updates are lost, as in
Java; nothing crashes.

## Found while building it

- Porffor's static data contains `{`/`}` in string literals. A brace-counting
  pass must ignore literals, or later declarations look as if they were
  inside a function. This left the JSON buffers shared and broke parsing
  under threads.
- Builtin prototypes are built lazily and published before they are complete.
  Two threads that first use `replace` at the same moment could see a
  `RegExp.prototype` without `Symbol.replace`.

## Limits (proof of concept)

- **Structure lock.** It is one global lock, so threads that mostly add
  properties or push to arrays serialise (the stress test uses about 1.8
  cores). Stage 2: per-object locks, and lock-free array writes within
  capacity with ordered publication on growth.
- **Safepoints** are only at loop heads and allocation. Deep recursion
  without loops or allocation delays a collection.
- **Monitors** are striped (256), so two objects can share a lock. Nested
  `synchronized` on different objects can deadlock in orders Java would allow.
- **x86-64 only.** Correctness relies on x86-64 store ordering (TSO); ARM
  needs explicit barriers on publication.
- **Rewrites Porffor's output.** The transform rewrites Porffor alpha-22's C
  text and fails loudly if a pattern it needs is missing. A long-term home is
  Porffor's code generator or a maintained patch set.
- **No `wait`/`notify` or `volatile` yet.** There is no `wait`/`notify` and
  no Java-style memory-model guarantee for unsynchronised reads beyond what
  x86 gives.
