// Appended to a bundled async page. Shared by the JavaScript and Rust compilers.
function __continue(frame, consume) {
  __write(frame);
  while (true) {
    try {
      const response = __read();
      if (response === undefined) return false;
      consume(response);
      return true;
    } catch (error) {
      __write({version: 1, type: 'error', error: error.message});
    }
  }
}

async function __respond(operation) {
  let complete = false;
  let result;
  let failure;
  let rejected = false;
  let idleTurns = 0;
  let idleDeadline = 0;
  let hostFrames = 0;
  operation.then(value => {
    result = value;
    complete = true;
  }, error => {
    failure = error;
    rejected = true;
    complete = true;
  });
  while (true) {
    await NativeApp.page.flushPromiseJobs();
    if (complete) {
      if (rejected) {
        const wakeAt = NativeApp.page.nextWakeAt();
        const eventStream = NativeApp.page.activeEventStream();
        __write({version: 1, type: 'error', error: failure instanceof Error ? failure.message : 'Async page operation failed',
          ...(eventStream === undefined ? {} : { eventStream }),
          ...(wakeAt === undefined ? {} : { wakeAt })});
        return true;
      }
      __write(result);
      return true;
    }
    const requests = NativeApp.page.takeBlockingRequests();
    if (!requests.length) {
      // Let pending promise jobs finish rendering before asking the host to wait.
      if (++idleTurns < 64) continue;
      const wakeAt = NativeApp.page.nextWakeAt();
      if (wakeAt === undefined) {
        // A native library can still be waiting on the process's I/O loop.
        if (!idleDeadline) idleDeadline = Date.now() + 7000;
        if (Date.now() < idleDeadline) continue;
        throw new Error('Async page I/O timed out without a host request');
      }
      if (++hostFrames > 256) throw new Error('Async page exceeded the request limit');
      if (!__continue({version: 1, type: 'wait', wakeAt}, response => {
        if (response.type !== 'tick') throw new Error('Expected a tick for the outstanding native timer');
      })) return false;
      NativeApp.page.fireTimer();
      idleTurns = 0;
      idleDeadline = 0;
      continue;
    }
    idleTurns = 0;
    idleDeadline = 0;
    for (const request of requests) {
      if (++hostFrames > 256) throw new Error('Async page exceeded the request limit');
      if (!__continue({version: 1, type: 'requests', requests: [request]}, response => {
        if (response.type !== 'result' || response.id !== request.id) {
          throw new Error('Expected a result for an outstanding async request');
        }
        NativeApp.page.completeRequest(response);
      })) return false;
    }
  }
}

async function __run() {
  try {
    if (!(await __respond(NativeApp.page.start()))) return;
    while (true) {
      let command;
      try {
        command = __read();
      } catch (error) {
        __write({version: 1, type: 'error', error: error.message});
        continue;
      }
      if (command === undefined) return;
      if (!(await __respond(NativeApp.page.handle(command)))) return;
    }
  } catch (error) {
    __write({version: 1, type: 'error', error: error.message});
  }
}
void __run();
