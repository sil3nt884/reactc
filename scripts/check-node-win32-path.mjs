// Compare reactc's Windows node:path (src/node-win32/path.js) with Node's path.win32.
//   node scripts/check-node-win32-path.mjs
import { win32 as reference } from 'node:path';
import * as ours from '../src/node-win32/path.js';

const samples = [
  '', '.', '..', '/', '\\', 'a', 'a/b', 'a\\b\\', 'a/../b', 'a/./b/', '../a', '../../a/b', 'C:', 'C:\\', 'C:/', 'c:a',
  'C:a\\b', 'C:\\a\\..\\..\\b', 'C:\\a\\b\\c.txt', 'C:/a//b///c', '\\\\server\\share', '\\\\server\\share\\',
  '\\\\server\\share\\a\\b', '//server/share/x', '\\\\?\\C:\\a', '\\\\.\\pipe\\name', 'file.tar.gz', '.hidden',
  'a/.b.c', 'dir/', 'dir\\\\', 'x\\..', 'C:\\..', '/a/b', '\\a\\b\\..\\c', 'D:\\other\\place',
];
let failures = 0;
let checks = 0;
function compare(name, args, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    if (failures <= 25) console.log(`${name}(${args.map(a => JSON.stringify(a)).join(', ')}): ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}
function run(name, ...args) {
  let actual, expected;
  try { actual = ours[name](...args); } catch (error) { actual = 'throws'; }
  try { expected = reference[name](...args); } catch (error) { expected = 'throws'; }
  compare(name, args, actual, expected);
}
for (const sample of samples) {
  for (const name of ['normalize', 'isAbsolute', 'dirname', 'basename', 'extname', 'parse', 'toNamespacedPath']) run(name, sample);
  run('basename', sample, '.txt');
  run('resolve', sample);
  for (const other of samples.slice(0, 20)) {
    run('join', sample, other);
    run('resolve', sample, other);
    run('relative', sample || '.', other || '.');
  }
  run('format', reference.parse(sample));
}
compare('sep', [], ours.sep, reference.sep);
compare('delimiter', [], ours.delimiter, reference.delimiter);
console.log(`${checks - failures} of ${checks} path.win32 checks match Node`);
process.exit(failures ? 1 : 0);
