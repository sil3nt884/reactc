// @reactc/threads with async/await: async run() functions, threads awaited
// like promises, and file I/O on each thread's own event loop.
// Build:  reactc build examples/threads/async.server.js --target windows --name AsyncThreads
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { Thread, spawn } from '@reactc/threads';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const started = Date.now();
const elapsed = () => `${Date.now() - started} ms`;

// --- Java style: an async run() ----------------------------------------------
class ReportWriter extends Thread {
  constructor(name, lines) {
    super();
    this.name = name;
    this.lines = lines;
  }

  async run() {
    const path = `${this.name}.txt`;
    await writeFile(path, this.lines.join('\n'));      // I/O on this thread's own loop
    await sleep(50);                                    // a timer on this thread
    const text = await readFile(path, 'utf8');
    await unlink(path);
    return `${this.name}: ${text.split('\n').length} lines`;
  }
}

// --- functional style: await a spawned async function ------------------------
async function countPrimes(limit) {
  let count = 0;
  for (let n = 2; n < limit; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) count++;
  }
  await sleep(10);
  return count;
}

// 1. A thread is a promise: await it directly.
const primes = await spawn(countPrimes, 200000);
console.log(`1. await spawn(...)            -> ${primes} primes below 200000 (${elapsed()})`);

// 2. Promise.all over threads: both run at the same time on separate cores.
const reports = await Promise.all([
  new ReportWriter('north', ['a', 'b', 'c']),          // created, not started: awaiting starts it
  new ReportWriter('south', ['x', 'y']).start(),
]);
console.log(`2. Promise.all([threads])      -> ${reports.join(' | ')} (${elapsed()})`);

// 3. Errors reject like any promise: try/await/catch, or .catch().
try {
  await spawn(async () => { await sleep(5); throw new Error('disk full'); });
} catch (error) {
  console.log(`3. try { await thread }        -> caught "${error.message}"`);
}

// 4. Promise.race: the first thread to finish wins.
const winner = await Promise.race([
  spawn(async () => { await sleep(300); return 'slow thread'; }),
  spawn(async () => { await sleep(20); return 'fast thread'; }),
]);
console.log(`4. Promise.race([threads])     -> ${winner} (${elapsed()})`);

// 5. The main thread keeps running while it awaits threads.
let ticks = 0;
const ticker = setInterval(() => ticks++, 5);
await Promise.all([1, 2, 3, 4].map(n => spawn(countPrimes, 100000 * n)));
clearInterval(ticker);
console.log(`5. main timer ticked ${ticks} times while 4 threads worked (${elapsed()})`);
