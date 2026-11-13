// Finds which step of stringify/replace/parse goes wrong under threads.
import { Thread, spawn, synchronized, collections } from '@reactc/threads';
const bad = [];
function textWork(tid) {
  for (let i = 0; i < 4000; i++) {
    const text = JSON.stringify({ tid, i, path: 'a-b-c-' + i });
    const expected = '{"tid":' + tid + ',"i":' + i + ',"path":"a-b-c-' + i + '"}';
    if (text !== expected) { synchronized(bad, () => bad.push('stringify ' + text)); continue; }
    const swapped = text.replace(/-/g, '+');
    if (swapped !== expected.replace(/-/g, '+')) { synchronized(bad, () => bad.push('replace ' + swapped)); continue; }
    let back = null;
    try { back = JSON.parse(swapped); } catch (error) { synchronized(bad, () => bad.push('parse threw ' + error.message + ' on ' + swapped)); continue; }
    if (back.path !== 'a+b+c+' + i) synchronized(bad, () => bad.push('parse ' + JSON.stringify(back)));
  }
  return 0;
}
const threads = [1, 2, 3, 4].map(tid => spawn(textWork, tid));
textWork(0);
for (const thread of threads) thread.join();
console.log(JSON.stringify({ errors: bad.length, first: bad.slice(0, 6) }));
