// Shared native page protocol framing. The host can reply while the core is
// inside a synchronous browser API, even during an async page operation.
const __fs = require('node:fs');
const __byte = new Uint8Array(1);
function __write(message) {
  console.log(JSON.stringify(message));
}
function __read() {
  let line = '';
  let discard = false;
  while (__fs.readSync(0, __byte, 0, 1, null) > 0) {
    const byte = __byte[0];
    if (byte === 10) {
      if (!discard && line.trim()) return JSON.parse(line);
      line = '';
      discard = false;
    } else if (!discard) {
      if (byte > 127 || line.length >= 262144) {
        __write({version: 1, type: 'error', error: 'Commands require ASCII-escaped JSON within 256 KiB'});
        discard = true;
        line = '';
      } else line += String.fromCharCode(byte);
    }
  }
  return undefined;
}

function __syncHost(request) {
  __write({version: 1, type: 'requests', requests: [request]});
  const response = __read();
  if (response?.type !== 'result' || response.id !== request.id) {
    throw new Error('Expected the outstanding synchronous host result');
  }
  return response.result;
}

NativeApp.page.setSynchronousHost(__syncHost);
