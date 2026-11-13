// Build the Node API probe (scripts/fixtures/node-api-probe) with reactc and
// run it natively. Every check must report "ok", as it does under Node.
//
//   node scripts/check-node-api-probe.mjs compiler/target/debug/reactc.exe [--host]
//
// Run from Windows. --host also builds the Linux program and runs it in WSL.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reactc = resolve(process.argv[2] ?? join(checkout, 'compiler', 'target', 'debug', 'reactc.exe'));
const entry = join(checkout, 'scripts', 'fixtures', 'node-api-probe', 'probe.server.js');

function build(target) {
  const outdir = join(checkout, 'dist', 'node-probe', target);
  const result = spawnSync(reactc, ['build', entry, '--target', target, '--name', 'NodeProbe', '--outdir', outdir],
    { cwd: checkout, stdio: ['ignore', 'ignore', 'inherit'], timeout: 1800000 });
  if (result.status !== 0) throw new Error(`reactc could not build the ${target} probe`);
  return outdir;
}

function report(label, output) {
  const line = output.trim().split('\n').pop();
  if (!line) throw new Error(`${label}: the probe printed no report`);
  const results = JSON.parse(line);
  const failed = Object.entries(results).filter(([, value]) => value !== 'ok');
  for (const [name, value] of failed) console.log(`  ${label} ${name}: ${value}`);
  console.log(`${label}: ${Object.keys(results).length - failed.length} of ${Object.keys(results).length} Node API checks ok`);
  return failed.length === 0;
}

let passed = true;
const windows = build('windows');
const run = spawnSync(join(windows, 'NodeProbe.exe'), [], { cwd: windows, encoding: 'utf8', timeout: 300000 });
passed = report('windows', run.stdout) && passed;
if (process.argv.includes('--host')) {
  const host = build('host');
  const mapped = '/mnt/' + host[0].toLowerCase() + host.slice(2).split('\\').join('/');
  const linux = spawnSync('wsl.exe', ['-e', 'sh', '-c', `cd '${mapped}' && ./NodeProbe`], { encoding: 'utf8', timeout: 300000 });
  passed = report('linux', linux.stdout) && passed;
}
const reference = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 300000 });
passed = report('node', reference.stdout) && passed;
process.exit(passed ? 0 : 1);
