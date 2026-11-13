// @reactc/threads example: Java-style threads that share ordinary objects.
// Build:  reactc build examples/threads/main.server.js --target windows --name ThreadsDemo
import { Thread, spawn, parallel, synchronized, currentThreadId } from '@reactc/threads';

// --- Java style: subclass Thread and override run() --------------------------
class PrimeCounter extends Thread {
  constructor(from, to) {
    super();
    this.from = from;
    this.to = to;
  }

  run() {
    let count = 0;
    for (let n = this.from; n < this.to; n++) if (isPrime(n)) count++;
    return count;
  }
}

function isPrime(n) {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

const counters = [new PrimeCounter(0, 250000), new PrimeCounter(250000, 500000)];
for (const counter of counters) counter.start();
const javaStyle = counters.reduce((sum, counter) => sum + counter.join(), 0);

// --- Functional style: spawn a function, or map over items in parallel -------
const countRange = (from, to) => {
  let count = 0;
  for (let n = from; n < to; n++) if (isPrime(n)) count++;
  return count;
};
const one = spawn(countRange, 0, 500000).join();
const quarters = parallel([0, 125000, 250000, 375000], start => countRange(start, start + 125000));

// --- Shared objects: every thread sees and changes the same Map --------------
const wordCounts = new Map();
const log = [];
const texts = ['the cat sat', 'the dog ran', 'a cat ran', 'the end'];
parallel(texts, text => {
  for (const word of text.split(' ')) {
    synchronized(wordCounts, () => wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1));
  }
  synchronized(log, () => log.push(`thread ${currentThreadId()} read "${text}"`));
});

// --- Errors: what a thread throws, join() throws ------------------------------
let caught = null;
try {
  spawn(() => { throw new RangeError('bad input on a thread'); }).join();
} catch (error) {
  caught = `${error.name}: ${error.message}`;
}

console.log(JSON.stringify({
  primesBelow500k: { javaStyle, functional: one, inQuarters: quarters.reduce((a, b) => a + b, 0) },
  wordCounts: Object.fromEntries([...wordCounts].sort()),
  threadsThatReadText: log.length,
  caught,
}, null, 2));
