// Audits Porffor C for reactc worker threads. Worker programs keep their
// mutable runtime state thread-local, which is only sound if no function that
// runs on libuv's shared thread pool reads or writes that state.
//
//   node scripts/audit-worker-statics.mjs path/to/app.c
//
// Lists the thread-pool entry points (functions whose address goes to
// porf_uv_queue), everything they reach, and any file-scope variable touched.
import { readFileSync } from 'node:fs';

const lines = readFileSync(process.argv[2], 'utf8').split('\n');
export const declaration = /^(static )?[A-Za-z_][A-Za-z0-9_ *]*[ *]([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])* *(=[^(]*)?;/;
const variables = new Set();
for (const line of lines) {
  if (!declaration.test(line) || line.includes('(') || /^(typedef|extern)|static const|^const/.test(line)) continue;
  const match = line.replace(/=.*/, '').match(/([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])* *;?\s*$/);
  if (match) variables.add(match[1]);
}

const definitions = new Map();
for (let i = 0; i < lines.length; i++) {
  const match = /^static [^(]*\b([A-Za-z_][A-Za-z0-9_]*)\(/.exec(lines[i]);
  if (!match || lines[i].trim().endsWith(';')) continue;
  let depth = 0;
  const body = [];
  for (let j = i; j < lines.length; j++) {
    body.push(lines[j]);
    depth += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
    if (depth === 0 && j > i && body.join('').includes('{')) break;
  }
  definitions.set(match[1], body.join('\n'));
}

const roots = [...new Set([...lines.join('\n').matchAll(/\(u64\)&(porf_[a-z0-9_]+)/g)].map(match => match[1]))]
  .filter(name => /run|work/.test(name));
let unsafe = 0;
for (const root of roots) {
  const seen = new Set();
  const queue = [root];
  const touched = [];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name) || !definitions.has(name)) continue;
    seen.add(name);
    const body = definitions.get(name);
    for (const variable of variables) {
      if (new RegExp('\\b' + variable + '\\b').test(body)) touched.push(name + ' -> ' + variable);
    }
    for (const call of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\(/g)) queue.push(call[1]);
  }
  unsafe += touched.length;
  console.log(`${root}: reaches ${seen.size} functions; file-scope variables touched: ${touched.join(', ') || 'none'}`);
}
console.log(`${variables.size} file-scope mutable variables; ${roots.length} thread-pool entry points`);
process.exit(unsafe ? 1 : 0);
