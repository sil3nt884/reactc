// Builds @reactc/threads programs with reactc and runs them natively on Windows
// and (with --host) Linux, repeating the stress tests to catch races:
// examples/threads (expected answers below), and poc/shared-heap's shared,
// stress (5x the rounds), textdebug, bench, async (await, timers and threads
// used as promises) and asyncio (fs/promises inside threads).
//
//   node scripts/check-reactc-shared-threads.mjs [reactc.exe] [--host] [--runs 20]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.slice(2).find((value, index, all) => !value.startsWith('--') && all[index - 1] !== '--runs');
const reactc = resolve(argument ?? join(root, 'compiler', 'target', 'debug', 'reactc.exe'));
const runsAt = process.argv.indexOf('--runs');
const runs = runsAt > 0 ? Number(process.argv[runsAt + 1]) : 20;
const out = join(root, 'dist', 'shared-threads');
mkdirSync(out, { recursive: true });

// stress: the shared test with 5x the rounds
const stress = join(out, 'stress.server.js');
writeFileSync(stress, readFileSync(join(root, 'poc', 'shared-heap', 'shared.js'), 'utf8')
  .replace('const ROUNDS = 20000;', 'const ROUNDS = 100000;').replace('=== 50', '=== 250'));
const exampleAnswer = JSON.stringify({
  primesBelow500k: { javaStyle: 41538, functional: 41538, inQuarters: 41538 },
  wordCounts: { a: 1, cat: 2, dog: 1, end: 1, ran: 2, sat: 1, the: 3 },
  threadsThatReadText: 4, caught: 'RangeError: bad input on a thread',
});
const tests = [
  { name: 'example', entry: join(root, 'examples', 'threads', 'main.server.js'), runs: 5, expect: exampleAnswer },
  { name: 'shared', entry: join(root, 'poc', 'shared-heap', 'shared.js'), runs },
  { name: 'stress', entry: stress, runs: Math.max(3, Math.round(runs / 4)) },
  { name: 'textdebug', entry: join(root, 'poc', 'shared-heap', 'textdebug.js'), runs },
  { name: 'bench', entry: join(root, 'poc', 'shared-heap', 'bench.js'), runs: 3 },
  { name: 'async', entry: join(root, 'poc', 'shared-heap', 'async.js'), runs },
  { name: 'asyncio', entry: join(root, 'poc', 'shared-heap', 'asyncio.js'), runs: Math.max(3, Math.round(runs / 4)) },
];
const toWsl = path => '/mnt/' + path[0].toLowerCase() + path.slice(2).replace(/\\/g, '/');
const wslRoot = toWsl(root);

function result(run) {
  const text = (run.stdout || '').trim();
  try { return { json: JSON.stringify(JSON.parse(text.slice(text.indexOf('{')))), text }; } catch { return { json: null, text }; }
}

function verdict(label, test, outputs) {
  let failures = 0;
  for (const run of outputs) {
    const { json, text } = result(run);
    const bad = run.status !== 0 || !json || (test.expect ? json !== test.expect : json.includes('false') || /"errors":[1-9]/.test(json));
    if (bad) {
      failures++;
      if (failures <= 2) console.log(`  ${label} ${test.name}: exit ${run.status} ${text.slice(0, 300)} ${(run.stderr || '').slice(0, 300)}`);
    }
  }
  const last = result(outputs.at(-1)).json || '';
  console.log(`${label} ${test.name}: ${outputs.length - failures}/${outputs.length} correct${/bench|stress/.test(test.name) ? '  ' + last : ''}`);
  return failures === 0;
}

let passed = true;
const targets = ['windows', ...(process.argv.includes('--host') ? ['host'] : [])];
for (const target of targets) {
  for (const test of tests) {
    const outdir = join(out, target, test.name);
    const build = spawnSync(reactc, ['build', test.entry, '--server', '--target', target, '--name', test.name, '--outdir', outdir],
      { cwd: root, encoding: 'utf8', timeout: 1800000 });
    if (build.status !== 0) { console.log(`${target} ${test.name}: build failed\n${build.stdout}\n${build.stderr}`); passed = false; continue; }
    const outputs = [];
    for (let i = 0; i < test.runs; i++) {
      outputs.push(target === 'windows'
        ? spawnSync(join(outdir, `${test.name}.exe`), [], { encoding: 'utf8', timeout: 300000 })
        : spawnSync('wsl.exe', ['-e', 'sh', '-c', `cd '${wslRoot}' && timeout 300 '${toWsl(join(outdir, test.name))}'`], { encoding: 'utf8', timeout: 400000 }));
    }
    passed = verdict(target === 'windows' ? 'windows' : 'linux', test, outputs) && passed;
  }
}
console.log(passed ? 'PASS: @reactc/threads programs are correct natively' : 'FAIL: see above');
process.exit(passed ? 0 : 1);
