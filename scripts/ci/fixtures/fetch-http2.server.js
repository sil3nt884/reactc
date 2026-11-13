// Compiled by reactc. The test server runs under Node.
const base = process.argv[2];
const secure = process.argv[3];
const legacy = process.argv[4];
const noAlpn = process.argv[5];
const plain = process.argv[6];
const prior = { httpVersion: '2' };

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const first = await fetch(secure + '/version');
  check(first.headers.get('x-http-version') === '2.0', 'HTTPS did not negotiate h2');
  check(await first.text() === '2.0', 'wrong HTTPS response');
  const fallback = await fetch(legacy + '/version');
  check(await fallback.text() === '1.1', 'HTTP/1.1 fallback failed');
  const unnegotiated = await fetch(noAlpn + '/version');
  check(await unnegotiated.text() === '1.1', 'HTTPS without ALPN did not use HTTP/1.1');
  const cleartext = await fetch(plain + '/version');
  check(await cleartext.text() === '1.1', 'ordinary cleartext fetch did not use HTTP/1.1');

  // The server delays this response until both streams are open.
  const [left, right] = await Promise.all([
    fetch(base + '/parallel', prior),
    fetch(base + '/parallel', prior),
  ]);
  check(await left.text() === await right.text(), 'requests did not share an HTTP/2 session');

  const upload = 'reactc'.repeat(20000);
  const echo = await fetch(base + '/echo', { ...prior, method: 'POST', body: upload });
  check(await echo.text() === String(upload.length), 'upload stalled or lost bytes');
  for (const [origin, options] of [[base, prior], [plain, {}]]) {
    let first = true;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(encoder.encode('one'));
          return;
        }
        const acknowledgement = await fetch(plain + '/first-upload-chunk');
        check(await acknowledgement.text() === 'received', 'server did not receive the first chunk before upload finished');
        controller.enqueue(encoder.encode('two'));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const sent = await fetch(origin + '/stream-echo', { ...options, method: 'POST', body, duplex: 'half' });
    check(await sent.text() === '6', 'streaming upload lost bytes');
  }

  const blobRequest = new Request(plain + '/echo', {
    method: 'POST', body: new Blob(['abc'], { type: 'text/example' }),
  });
  const blobCopy = blobRequest.clone();
  check(await blobCopy.text() === 'abc' && !blobRequest.bodyUsed, 'request clone consumed original');
  check(await (await fetch(blobRequest)).text() === '3', 'Blob upload failed');
  const form = new FormData();
  form.append('message', 'hello');
  form.append('file', new Blob(['abc']), 'upload.txt');
  const formReply = await fetch(plain + '/multipart', { method: 'POST', body: form });
  check(await formReply.text() === 'true', 'multipart upload failed');
  const formResponse = await fetch(plain + '/form-response');
  const parsed = await formResponse.formData();
  const file = parsed.get('file');
  check(parsed.get('message') === 'hello' && file.name === 'download.bin', 'multipart response fields failed');
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  check(fileBytes.length === 3 && fileBytes[1] === 255, 'multipart response corrupted binary data');

  const head = await fetch(plain + '/version', { method: 'HEAD' });
  check(head.body === null && await head.text() === '' && !head.bodyUsed, 'HEAD response exposed a body');

  const binary = await fetch(base + '/binary', prior);
  check(binary.body instanceof ReadableStream, 'response body is not a ReadableStream');
  const binaryClone = binary.clone();
  const bytes = await binary.bytes();
  check(bytes.length === 200000 && bytes[199999] === 255, 'download stalled or lost bytes');
  check(binary.bodyUsed && (await binaryClone.blob()).size === bytes.length, 'response clone failed');
  const compressed = await fetch(base + '/compressed', prior);
  const decoded = await compressed.bytes();
  check(decoded.length === 200000 && decoded[199999] === 255, 'compressed download failed');

  const cancelled = await fetch(base + '/cancel', prior);
  const reader = cancelled.body.getReader();
  await reader.read();
  await reader.cancel();
  const redirected = await fetch(base + '/redirect', prior);
  check(redirected.redirected && await redirected.text() === '2.0', 'redirect failed after stream cancellation');
  const restarted = await fetch(base + '/goaway', prior);
  check(await restarted.text() === '2.0', 'GOAWAY response failed');
  const after = await fetch(base + '/version', prior);
  check(await after.text() === '2.0', 'request failed after GOAWAY');
  console.log('HTTP/2 fetch passed');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
