// Worker threads and fork in a reactc server: each literal entry becomes a
// native thread in the same executable. Prints one JSON report.
import { fork } from 'node:child_process';
import { Worker, isMainThread, threadId } from 'node:worker_threads';
import { describe, richValue } from './shape.js';

const report = { main: { isMainThread, threadId } };
const next = (emitter, name) => new Promise((resolve, reject) => {
  emitter.once(name, resolve);
  if (name !== 'error') emitter.once('error', reject);
});

// A worker with workerData that computes, reports and answers one message.
const worker = new Worker(new URL('./primes.worker.js', import.meta.url), { workerData: { limit: 20000 } });
report.worker = await next(worker, 'message');
worker.postMessage({ echo: 'héllo Ω' });
report.echo = await next(worker, 'message');
report.workerExit = await next(worker, 'exit');

// Two workers at once run on separate threads.
const pair = [0, 1].map(index => new Worker('./primes.worker.js', { workerData: { limit: 5000 + index } }));
const answers = await Promise.all(pair.map(each => next(each, 'message')));
report.pair = {
  distinctThreads: new Set(answers.map(answer => answer.threadId)).size,
  counts: answers.map(answer => answer.count),
};
for (const each of pair) each.postMessage({ echo: 'bye' });
await Promise.all(pair.map(each => next(each, 'exit')));

// A forked child: process.send, and process.exit ends only its thread.
const child = fork('./child.js', ['first-argument']);
child.send({ n: 21 });
report.fork = await next(child, 'message');
report.forkExit = await new Promise(resolve => child.once('exit', code => resolve(code)));
report.mainStillRunning = true;

// Messages are structured clones: types, undefined, -0, BigInt and cycles survive.
const cloner = new Worker('./clone.worker.js', { workerData: richValue() });
report.cloneInWorker = await next(cloner, 'message');
try {
  cloner.postMessage({ run() {} });
  report.uncloneable = 'sent';
} catch (error) {
  report.uncloneable = error.name;
}
cloner.postMessage(richValue());
report.cloneBack = describe(await next(cloner, 'message'));
await next(cloner, 'exit');

// fork keeps Node's JSON by default; serialization: 'advanced' clones.
const advanced = fork('./advanced.child.js', [], { serialization: 'advanced' });
advanced.send(new Map([['a', 2n], ['b', 3n]]));
const sum = await next(advanced, 'message');
report.forkAdvanced = { isMap: sum.isMap, total: String(sum.total) };
await new Promise(resolve => advanced.once('exit', resolve));

process.stdout.write(JSON.stringify(report) + '\n');
