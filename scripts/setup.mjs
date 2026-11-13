// Prepares this checkout to build reactc from scratch: checks the
// prerequisites and installs every tool into tools/.
//
//   npm run setup
//   npm run setup -- --wasm   also the WebAssembly target's tools (about 640 MB)
//
// Windows: needs Rust (cargo) and WSL with Ubuntu 26.04; the tools are
// installed by running scripts/ci/install-tools.sh inside WSL.
// Linux: needs Ubuntu 26.04 (or matching glibc) and Rust; runs it directly.
// Then: npm run build:compiler
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const problems = [];
const wasm = process.argv.includes('--wasm');
const options = wasm ? ['--wasm'] : [];
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });

if (run('cargo', ['--version']).status !== 0) {
  problems.push('Rust is not installed: get it from https://rustup.rs, then open a new terminal.');
}

let wslRoot = null;
if (windows) {
  const distro = run('wsl.exe', ['-e', 'sh', '-c', '. /etc/os-release && echo "$VERSION_ID"']);
  const version = (distro.stdout || '').replace(/\0/g, '').trim();
  if (distro.status !== 0) {
    problems.push('WSL is not available: run "wsl --install -d Ubuntu-26.04" in an administrator PowerShell, restart, and finish the Ubuntu setup.');
  } else if (version !== '26.04') {
    problems.push(`WSL's default distribution is Ubuntu ${version || '(unknown)'}; reactc's toolchain needs Ubuntu 26.04. ` +
      'Install it with "wsl --install -d Ubuntu-26.04" and make it the default with "wsl --set-default Ubuntu-26.04".');
  }
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(root);
  wslRoot = match ? `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}` : null;
  if (!wslRoot) problems.push('Clone the repository onto a drive letter (for example C:\\src\\reactc) so WSL can reach it.');
}

if (problems.length) {
  console.error('Setup cannot continue yet:\n' + problems.map(problem => '  - ' + problem).join('\n'));
  process.exit(1);
}

console.log('Installing tools into ' + resolve(root, 'tools') + ' (the first run downloads and builds about 2 GB; allow 20-40 minutes)...');
const install = windows
  ? run('wsl.exe', ['-e', 'sh', '-c', `cd '${wslRoot}' && sh scripts/ci/install-tools.sh ${options.join(' ')}`], { stdio: 'inherit' })
  : run('sh', ['scripts/ci/install-tools.sh', ...options], { cwd: root, stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status ?? 1);
console.log('\nSetup complete. Build the compiler with: npm run build:compiler' + (wasm ? ' -- --wasm' : ''));
