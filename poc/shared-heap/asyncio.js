// libuv I/O inside threads: each thread awaits fs/promises calls on its own
// libuv loop while the main thread does the same. Prints one JSON report.
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { parallel, collections } from '@reactc/threads';

async function roundTrip(id) {
  const path = `threads-io-${id}.txt`;
  let ok = 0;
  for (let round = 0; round < 20; round++) {
    const text = `thread ${id} round ${round} ` + 'x'.repeat(200 + id);
    await writeFile(path, text);
    const back = await readFile(path, 'utf8');
    if (back === text) ok++;
  }
  await unlink(path);
  return ok;
}

const mainIo = roundTrip(0);
const results = parallel([1, 2, 3, 4], id => roundTrip(id));
const mainResult = await mainIo;
console.log(JSON.stringify({ threads: results.every(ok => ok === 20), main: mainResult === 20, results, collections: collections() }));
