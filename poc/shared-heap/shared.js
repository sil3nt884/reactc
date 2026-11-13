// Shared-heap threads proof of concept: several OS threads and the main
// thread change the same ordinary JS objects (an object, an array, a Map, a
// Set and objects they add) while all of them allocate enough to force
// stop-the-world collections. Prints one JSON report.
import { Thread, spawn, synchronized, collections } from '@reactc/threads';

// --- one object graph, shared by every thread ------------------------------
const shared = { count: 0, items: [], byKey: new Map(), names: new Set(), racy: 0, textErrors: 0 };
const ROUNDS = 20000;

function work(tid, rounds) {
  let local = 0;
  for (let i = 0; i < rounds; i++) {
    synchronized(shared, () => {
      shared.count++;
      shared.items.push(tid * 1000000 + i);
      shared.byKey.set('k' + (i % 250) + '-' + tid, { tid, i });
      shared.names.add('n' + (i % 100) + '-' + tid);
    });
    shared.racy++;  // unsynchronised on purpose: updates may be lost, nothing may break
    const garbage = { i, text: 'x' + i + '-' + tid, list: [i, i + 1, i + 2] };
    local += garbage.list.length;
    if (i % 2000 === 0) synchronized(shared, () => { shared['t' + tid + '_' + i] = garbage; });
    // regex and JSON keep per-thread working state
    if (i % 250 === 0) {
      const text = JSON.stringify({ tid, i, path: 'a-b-c-' + i });
      const back = JSON.parse(text.replace(/-/g, '+'));
      if (back.path !== 'a+b+c+' + i || back.tid !== tid) shared.textErrors++;
    }
  }
  return local;
}

class Counter extends Thread {
  constructor(tid, rounds) { super(); this.tid = tid; this.rounds = rounds; }
  run() { return work(this.tid, this.rounds); }
}

const threads = [new Counter(1, ROUNDS).start(), new Counter(2, ROUNDS).start(), spawn(work, 3, ROUNDS), spawn(work, 4, ROUNDS)];
const mainResult = work(0, ROUNDS);   // the main thread works on the same objects meanwhile
const results = threads.map(thread => thread.join());

// --- checks ------------------------------------------------------------------
const total = 5 * ROUNDS;
const sorted = shared.items.slice().sort((a, b) => a - b);
let unique = true;
for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) { unique = false; break; }
let perThread = true;
for (let tid = 0; tid <= 4; tid++) {
  let seen = 0;
  for (const item of shared.items) if (Math.floor(item / 1000000) === tid) seen++;
  if (seen !== ROUNDS) perThread = false;
}
const added = Object.keys(shared).filter(key => /^t[0-9]+_[0-9]+$/.test(key)).length;
const sample = shared['t3_2000'];
let thrown = null;
try {
  new Thread(() => { throw new RangeError('from a thread'); }).start().join();
} catch (error) {
  thrown = error instanceof RangeError && error.message;
}

console.log(JSON.stringify({
  count: shared.count === total,
  items: shared.items.length === total,
  unique,
  perThread,
  mapSize: shared.byKey.size === 250 * 5,
  mapValue: shared.byKey.get('k7-2').tid === 2,
  setSize: shared.names.size === 100 * 5,
  addedProperties: added === 50,
  objectFromThread: sample !== undefined && sample.text === 'x2000-3' && sample.list[2] === 2002,
  results: results.every(result => result === 3 * ROUNDS) && mainResult === 3 * ROUNDS,
  exceptionCrossesThreads: thrown === 'from a thread',
  regexAndJson: shared.textErrors === 0,
  racyUpdates: shared.racy,
  collectionsWhileShared: collections(),
}));
