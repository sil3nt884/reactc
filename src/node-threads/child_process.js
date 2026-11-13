// node:child_process for reactc servers: Porffor's module, with fork() of a
// literal module path running that module as a native thread (see
// worker_threads.js). Windows servers use src/node-win32/child_process.js.
import * as base from 'node:child_process';
import { forkThread } from 'node:worker_threads';

export * from 'node:child_process';

export function fork(spec, args, options) {
  return forkThread(spec, args, options);
}

const childProcess = { ...(base.default ?? base), fork };
export default childProcess;
