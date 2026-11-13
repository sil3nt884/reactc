// Describes the workerData it was given, then sends each message back.
import { parentPort, workerData } from 'node:worker_threads';
import { describe } from './shape.js';

parentPort.postMessage(describe(workerData));
parentPort.once('message', value => {
  parentPort.postMessage(value);
  parentPort.close();
});
