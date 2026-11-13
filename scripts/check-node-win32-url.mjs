// Compare reactc's Windows file URL conversion (src/node-win32/url.js) with
// Node's. Run on Windows, where Node uses the same rules:
//   node scripts/check-node-win32-url.mjs
import * as node from 'node:url';
import * as ours from '../src/node-win32/url.js';

if (process.platform !== 'win32') {
  console.log('SKIP: Node only applies Windows file URL rules on Windows');
  process.exit(0);
}
let ok = 0;
let all = 0;
function compare(name, input, run) {
  all++;
  let actual, expected;
  try { actual = run(ours); } catch { actual = 'throws'; }
  try { expected = run(node); } catch { expected = 'throws'; }
  if (actual === expected) ok++;
  else console.log(`${name}(${JSON.stringify(input)}): ${actual} != ${expected}`);
}
const paths = ['C:\\a\\b c.txt', 'C:\\x\\%y#z?.txt', 'rel\\f.txt', 'D:\\', '\\\\server\\share\\dir\\f.txt', 'C:\\dir\\',
  'C:/mixed/slashes.txt', 'C:\\ü\\é.txt', 'C:\\tab\there'];
for (const path of paths) compare('pathToFileURL', path, url => url.pathToFileURL(path).href);
const urls = ['file:///C:/a/b%20c.txt', 'file://server/share/f.txt', 'file:///D:/', 'file:///C:/x/%25y%23z',
  'file:///C:/%C3%BC.txt', 'file:///C:/a%2Fb', 'file:///no-drive', 'http://x/y', 'file:///C:/a%5Cb'];
for (const href of urls) {
  compare('fileURLToPath', href, url => url.fileURLToPath(href));
  compare('fileURLToPath(URL)', href, url => url.fileURLToPath(new URL(href)));
}
console.log(`${ok} of ${all} file URL checks match Node`);
process.exit(ok === all ? 0 : 1);
