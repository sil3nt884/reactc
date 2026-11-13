// Build the threads fixture (scripts/fixtures/threads) with reactc and run it
// natively. Worker threads and fork() children run as OS threads inside the
// one executable; the report must match what Node prints for the same files.
//
//   node scripts/check-reactc-threads.mjs [compiler/target/debug/reactc.exe] [--host]
//
// Run from Windows. --host also builds the Linux program and runs it in WSL.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.slice(2).find(value => !value.startsWith('--'));
const reactc = resolve(argument ?? join(checkout, 'compiler', 'target', 'debug', 'reactc.exe'));
const fixture = join(checkout, 'scripts', 'fixtures', 'threads');
const entry = join(fixture, 'main.server.js');

function build(target) {
  const outdir = join(checkout, 'dist', 'threads', target);
  const result = spawnSync(reactc, ['build', entry, '--target', target, '--name', 'Threads', '--outdir', outdir],
    { cwd: checkout, stdio: ['ignore', 'ignore', 'inherit'], timeout: 1800000 });
  if (result.status !== 0) throw new Error(`reactc could not build the ${target} threads fixture`);
  return outdir;
}

function lastLine(label, run) {
  if (run.error) throw run.error;
  const line = (run.stdout ?? '').trim().split('\n').pop();
  if (run.status !== 0 || !line) {
    console.log(`${label}: exit ${run.status}\n${run.stderr ?? ''}`);
    return null;
  }
  return JSON.parse(line);
}

// Paths in the fixture resolve against the importing file, so Node runs from
// the fixture folder to give the same answer as the native build.
const node = lastLine('node', spawnSync(process.execPath, [entry], { cwd: fixture, encoding: 'utf8', timeout: 300000 }));
if (!node) process.exit(1);
const expected = JSON.stringify(node);
console.log(`node: ${expected}`);

let passed = true;
function compare(label, report) {
  const actual = report && JSON.stringify(report);
  const same = actual === expected;
  console.log(`${label}: ${same ? 'matches Node' : 'differs: ' + actual}`);
  passed = passed && same;
}

const windows = build('windows');
compare('windows', lastLine('windows', spawnSync(join(windows, 'Threads.exe'), [], { cwd: fixture, encoding: 'utf8', timeout: 300000 })));
if (process.argv.includes('--host')) {
  const host = build('host');
  const mapped = path => '/mnt/' + path[0].toLowerCase() + path.slice(2).split('\\').join('/');
  compare('linux', lastLine('linux', spawnSync('wsl.exe', ['-e', 'sh', '-c', `cd '${mapped(fixture)}' && '${mapped(host)}/Threads'`],
    { encoding: 'utf8', timeout: 300000 })));
}
process.exit(passed ? 0 : 1);
