// npm script helper:
//   node scripts/reactc.mjs build [--target windows|linux] [--only server|client]
//   node scripts/reactc.mjs start [--target windows|linux]
//
// Without --target it builds for the machine it runs on: Windows executables
// on Windows, Linux executables on Linux. Either target can be built from
// either system. Each target goes to its own folder: dist/windows, dist/linux.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(project, 'reactc.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const root = resolve(project, config.root ?? '.');
const [command, ...args] = process.argv.slice(2);

// --target windows|linux, defaulting to this machine
const targetAt = args.indexOf('--target');
const target = targetAt >= 0 ? args[targetAt + 1] : process.platform === 'win32' ? 'windows' : 'linux';
if (!['windows', 'linux'].includes(target)) fail('--target must be windows or linux');
const rest = targetAt >= 0 ? args.filter((_, index) => index !== targetAt && index !== targetAt + 1) : args;
const outDir = resolve(project, config.outDir ?? 'dist', target);
const exe = name => (target === 'windows' ? name + '.exe' : name);

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The same lookup as build.ps1: the configured root (a packaged reactc or the
// checkout), then REACTC_HOME, then reactc on PATH.
function findReactc() {
  const exe = process.platform === 'win32' ? 'reactc.exe' : 'reactc';
  if (existsSync(join(root, 'bin', exe))) return join(root, 'bin', exe);
  // in a reactc checkout: the newer of the release and debug builds
  const built = [join(root, 'compiler', 'target', 'release', exe), join(root, 'compiler', 'target', 'debug', exe)]
    .filter(candidate => existsSync(candidate))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (built.length) return built[0];
  if (process.env.REACTC_HOME && existsSync(join(process.env.REACTC_HOME, 'bin', exe))) return join(process.env.REACTC_HOME, 'bin', exe);
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['reactc'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim().split(/\r?\n/)[0];
  if (existsSync(join(root, 'compiler', 'Cargo.toml'))) {
    console.log('Building reactc in the checkout (first run only)...');
    const cargo = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(root, 'compiler', 'Cargo.toml')],
      { stdio: 'inherit' });
    if (cargo.status !== 0) fail('Building reactc failed');
    return join(root, 'compiler', 'target', 'debug', exe);
  }
  fail('reactc not found: set "root" in reactc.config.json to a reactc folder, set REACTC_HOME, or put reactc on PATH');
}

// The libraries (@reactc/threads, @reactc/ui) are dependencies: install them
// once so editors and npm run dev:server find them.
function installDependencies() {
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  if (!manifest.dependencies || existsSync(join(project, 'node_modules'))) return;
  console.log('Installing dependencies (first build only)...');
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'],
    { stdio: 'inherit', cwd: project, shell: process.platform === 'win32' });
  if (npm.status !== 0) fail('npm install failed');
}

function build() {
  installDependencies();
  console.log(`Building for ${target} into ${outDir}`);
  const result = spawnSync(findReactc(), ['build', '--config', configPath, '--target', target, '--outdir', outDir, ...rest],
    { stdio: 'inherit', cwd: project });
  process.exit(result.status ?? 1);
}

async function waitForServer(url, server) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) fail('The server exited with code ' + server.exitCode);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  fail('The server did not answer at ' + url);
}

async function start() {
  if ((target === 'windows') !== (process.platform === 'win32')) fail(`${target} executables do not run on this system.`);
  const serverExe = join(outDir, 'server', exe(config.server.name));
  const clientExe = join(outDir, 'client', exe(config.client.name));
  if (!existsSync(serverExe)) fail(`Missing ${serverExe}; run npm run build first.`);
  // tasks.json is saved in data/.
  const data = join(project, 'data');
  mkdirSync(data, { recursive: true });
  const server = spawn(serverExe, [], { cwd: data, stdio: 'inherit' });
  await waitForServer(config.client.httpOrigin + '/health', server);
  // The Linux client is a protocol core without a window of its own: run it
  // with a host (see the reactc README). On Linux, start serves the API.
  if (target === 'linux') {
    console.log('API on ' + config.client.httpOrigin + ' (Ctrl+C stops it)');
    return;
  }
  if (!existsSync(clientExe)) fail(`Missing ${clientExe}; run npm run build first.`);
  const client = spawn(clientExe, [], { cwd: join(outDir, 'client'), stdio: 'inherit' });
  client.on('exit', () => server.kill());
  server.on('exit', code => { if (client.exitCode === null) console.error('The server stopped (' + code + ')'); });
}

if (command === 'build') build();
else if (command === 'start') await start();
else fail('usage: node scripts/reactc.mjs build [--target windows|linux] [--only server|client] | start [--target windows|linux]');
