// async/await inside threads: each thread runs its own event loop, so awaits,
// timers and promise chains started in run() finish on that thread. Collections
// happen while threads are suspended at awaits. Prints one JSON report.
import { Thread, spawn, parallel, parallelAsync, synchronized, collections } from '@reactc/threads';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const shared = { events: [] };

// Java style with an async run(). Delays differ by far more than Windows'
// ~15.6 ms timer tick, so b finishes first on every platform.
class Fetcher extends Thread {
  constructor(name, delay) { super(); this.name = name; this.delay = delay; }
  async run() {
    await sleep(this.delay);
    const parts = await Promise.all([1, 2, 3].map(async n => { await sleep(n); return n * 10; }));
    synchronized(shared, () => shared.events.push(this.name));
    return this.name + ':' + parts.join(',');
  }
}

// functional style: async functions on threads, allocating across awaits
async function churn(seed) {
  let total = 0;
  const kept = [];
  for (let round = 0; round < 40; round++) {
    const batch = [];
    for (let i = 0; i < 2000; i++) batch.push({ seed, round, i, text: 'v' + i });
    kept.push(batch[round]);
    await sleep(0);
    total += batch.length;
  }
  return { seed, total, kept: kept.every((item, round) => item.round === round && item.seed === seed) };
}

const fetchers = [new Fetcher('a', 150).start(), new Fetcher('b', 5).start()];
const fetched = fetchers.map(thread => thread.join());

const churned = parallel([1, 2, 3, 4], seed => churn(seed));

let rejected = null;
try {
  spawn(async () => { await sleep(2); throw new TypeError('rejected on a thread'); }).join();
} catch (error) {
  rejected = error instanceof TypeError && error.message;
}

// a timer the thread does not await still runs before the thread finishes
const fireAndForget = spawn(() => {
  const box = { fired: false };
  setTimeout(() => { box.fired = true; }, 5);
  return box;
}).join();

// joinAsync keeps main's event loop running while threads work
let mainTicks = 0;
const ticker = setInterval(() => { mainTicks++; }, 1);
const slow = spawn(async () => { await sleep(30); return 'slow done'; });
const viaJoinAsync = await slow.joinAsync();
const viaParallelAsync = await parallelAsync([5, 6], async n => { await sleep(n); return n * n; });

// a thread is a promise that runs on its own core
const awaited = await spawn(async n => { await sleep(3); return n + 1; }, 41);
const awaitedClass = await new Fetcher('c', 1);   // created, not started: awaiting starts it
const all = await Promise.all([spawn(n => n * 2, 1), spawn(async n => { await sleep(2); return n * 2; }, 2), 3]);
let caughtByCatch = null;
await spawn(() => { throw new RangeError('caught by .catch'); }).catch(error => { caughtByCatch = error.message; });
const adopted = await (async () => spawn(() => 'adopted by an async function'))();
const raced = await Promise.race([spawn(async () => { await sleep(200); return 'slow'; }), spawn(() => 'fast')]);
clearInterval(ticker);

console.log(JSON.stringify({
  fetched: fetched.join(' ') === 'a:10,20,30 b:10,20,30',
  orderByDelay: shared.events.filter(name => name !== 'c').join('') === 'ba',
  churned: churned.every((result, index) => result.seed === index + 1 && result.total === 80000 && result.kept),
  rejected: rejected === 'rejected on a thread',
  fireAndForget: fireAndForget.fired === true,
  joinAsync: viaJoinAsync === 'slow done',
  parallelAsync: viaParallelAsync.join(',') === '25,36',
  awaitThread: awaited === 42,
  awaitUnstarted: awaitedClass === 'c:10,20,30',
  promiseAll: all.join(',') === '2,4,3',
  promiseCatch: caughtByCatch === 'caught by .catch',
  adoptedByAsync: adopted === 'adopted by an async function',
  promiseRace: raced === 'fast',
  mainKeptRunning: mainTicks > 3,
  collections: collections(),
}));
