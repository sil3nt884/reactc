// Parallel speed check: the same CPU-bound work, reading one shared object
// graph and allocating as it goes, on 1 thread and then on 4 threads.
import { Thread, spawn, synchronized, collections } from '@reactc/threads';
const data = { limits: [], label: 'shared input' };
for (let i = 0; i < 4; i++) data.limits.push(60000 + i);

function primes(limit) {
  let count = 0;
  for (let n = 2; n < limit; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) count++;
    if (n % 64 === 0) { const temp = { n, label: data.label }; count += temp.n === n ? 0 : 1; }
  }
  return count;
}

const now = () => Date.now();
let started = now();
const serial = data.limits.map(limit => primes(limit * 3));
const serialMs = now() - started;

started = now();
const threads = data.limits.map(limit => spawn(primes, limit * 3));
const parallel = threads.map(thread => thread.join());
const parallelMs = now() - started;

console.log(JSON.stringify({
  same: JSON.stringify(serial) === JSON.stringify(parallel),
  serialMs, parallelMs, speedup: Math.round(serialMs / parallelMs * 100) / 100,
  collections: collections(),
}));
