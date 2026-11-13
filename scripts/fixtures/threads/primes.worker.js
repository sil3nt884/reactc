import { isMainThread, parentPort, threadId, workerData } from 'node:worker_threads';

let count = 0;
for (let n = 2; n < workerData.limit; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) { prime = false; break; }
  }
  if (prime) count++;
}
parentPort.postMessage({ count, threadId, isMainThread });
parentPort.once('message', message => {
  parentPort.postMessage({ echoed: message.echo });
  // Closing the port lets the worker's event loop end, and its thread exits.
  parentPort.close();
});
