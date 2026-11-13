// Build the reactc compiler and package it as a self-contained folder.
//
//   npm run build:compiler                    -> dist/reactc
//   node scripts/build-compiler.mjs --out D:\tools\reactc [--wasm] [--smoke-native]
//
// Run it from Windows (PowerShell or a terminal with cargo on PATH). The
// package holds everything reactc reads at build time, so bin/reactc.exe
// works from any folder:
//
//   bin/reactc(.exe)   the compiler
//   src/  native/      the page runtime and the Windows host compiled into apps
//   tools/             Porffor, the C toolchain (run through WSL on Windows),
//                      Skia and the native libraries
//   packages/reactc-ui, templates/node-react-app, README.md, VERSION.json
//
// --wasm also copies the WebAssembly toolchain (about 640 MB).
// --smoke-native also compiles a native executable with the packaged compiler.
//
// Release builds (see .github/workflows/release.yml) assemble both packages on
// Linux:
//   --os windows|linux   the package's platform (default: this one)
//   --exe PATH           a prebuilt compiler binary instead of cargo build
//                        (reactc.exe from the Windows job)
//   --dereference        copy tool symlinks as files, for zip archives
//   --no-self-test       skip the bundle self-test (cross-assembled packages)
//   --tools DIR          take the tools from DIR instead of ./tools
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = resolve(option('--out') ?? join(checkout, 'dist', 'reactc'));
const windows = process.platform === 'win32';   // where this script runs
const packageOs = option('--os') ?? (windows ? 'windows' : 'linux');
if (!['windows', 'linux'].includes(packageOs)) throw new Error('--os must be windows or linux');
const exe = packageOs === 'windows' ? 'reactc.exe' : 'reactc';
const prebuilt = option('--exe');
const toolsDir = resolve(option('--tools') ?? join(checkout, 'tools'));

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed (${result.status})`);
}

function wslPath(path) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  if (!match) throw new Error('Cannot map ' + path + ' into WSL');
  return '/mnt/' + match[1].toLowerCase() + '/' + match[2].split('\\').join('/');
}

function quote(text) {
  return "'" + text.split("'").join("'\\''") + "'";
}

// 1. The compiler, optimised (or the prebuilt one).
if (prebuilt) {
  if (!existsSync(prebuilt)) throw new Error('--exe ' + prebuilt + ' does not exist');
} else {
  if ((packageOs === 'windows') !== windows) throw new Error('--os ' + packageOs + ' needs --exe: cargo builds for this system');
  console.log('Building reactc (release)...');
  run('cargo', ['build', '--release', '--locked', '--manifest-path', join(checkout, 'compiler', 'Cargo.toml')]);
}

// 2. Sources reactc reads at build time. These are replaced on every run.
console.log('Packaging ' + out);
mkdirSync(out, { recursive: true });
const skipped = new Set(['node_modules', 'dist', 'data', '__pycache__']);
const copy = (from, to) => {
  rmSync(join(out, to), { recursive: true, force: true });
  cpSync(join(checkout, from), join(out, to), {
    recursive: true,
    filter: source => !source.split(/[\\/]/).some(part => skipped.has(part)),
  });
};
mkdirSync(join(out, 'bin'), { recursive: true });
cpSync(prebuilt ? resolve(prebuilt) : join(checkout, 'compiler', 'target', 'release', exe), join(out, 'bin', exe));
copy('src', 'src');
copy('native', 'native');
copy('host', 'host');
copy('packages/reactc-ui', 'packages/reactc-ui');
copy('packages/reactc-threads', 'packages/reactc-threads');
copy('packages/reactc-native', 'packages/reactc-native');
copy('templates', 'templates');

// 3. Tools. The toolchain contains Linux symlinks and executables, so on
// Windows it is copied inside WSL. Copies are incremental.
const tools = ['porf', 'local', 'skia-win', 'node-win', 'ada-win', 'node-host', 'ada'];
if (args.includes('--wasm')) tools.push('wasi-sdk', 'wasmtime', 'wasmtime-c-linux', 'ada-wasi');
// the Android runtime's C API is optional (it needs the Android NDK; see native/wasm/README.md)
if (args.includes('--wasm') && existsSync(join(toolsDir, 'wasmtime-c-android'))) tools.push('wasmtime-c-android');
for (const tool of tools) {
  if (!existsSync(join(toolsDir, tool))) throw new Error(`${join(toolsDir, tool)} is missing; run npm run setup (see tools/README.md)`);
}
console.log('Copying tools: ' + tools.join(', '));
const sources = tools.map(tool => (windows ? wslPath(join(toolsDir, tool)) : join(toolsDir, tool)));
const target = windows ? wslPath(join(out, 'tools')) : join(out, 'tools');
const copyFlags = args.includes('--dereference') ? '-a -L -u' : '-a -u';
const script = `mkdir -p ${quote(target)} && cp ${copyFlags} ${sources.map(quote).join(' ')} ${quote(target)}/`;
if (windows) run('wsl.exe', ['-e', 'bash', '-c', script]);
else run('sh', ['-c', script]);
cpSync(join(checkout, 'tools', 'README.md'), join(out, 'tools', 'README.md'));

// 4. Version and usage.
const version = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(checkout, 'compiler', 'Cargo.toml'), 'utf8'))[1];
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: checkout, encoding: 'utf8' }).stdout.trim() !== '';
writeFileSync(join(out, 'VERSION.json'), JSON.stringify({
  name: 'reactc', version, commit: commit + (dirty ? '+local-changes' : ''),
  built: new Date().toISOString(), buildPlatform: process.platform, os: packageOs, tools,
}, null, 2) + '\n');
writeFileSync(join(out, 'README.md'), `# reactc ${version}

Compiles React (TSX/JSX) user interfaces and Node servers into native
executables. Built from commit ${commit}${dirty ? ' with local changes' : ''}.

## Use

Add \`bin\` to PATH, or call \`bin\\${exe}\` directly, from any folder:

\`\`\`
${exe} new C:\\path\\to\\my-app                          # a Node + React project with build scripts
${exe} new --list                                        # available templates
${exe} build App.tsx --name MyApp --title "My app"        # Windows UI: MyApp.exe
${exe} build server/index.ts --server --name MyServer    # Windows console server: MyServer.exe
${exe} build                                             # uses reactc.config.json in this folder
${exe} build --config path\\to\\reactc.config.json --only client
\`\`\`

Run \`${exe} build\` without arguments in a folder that has no configuration
to see every option.

## Requirements

On Windows, builds run the bundled C toolchain (\`tools/local\`) through WSL
with an Ubuntu distribution. The produced executables do not need WSL.

reactc finds this folder from its executable. Set \`REACTC_HOME\` to use
another copy, or \`--root\` / \`"root"\` for a single build.

## Contents

- \`bin/\`: the compiler.
- \`src/\`, \`native/\`: the runtime and the Windows host compiled into every app.
- \`tools/\`: ${tools.join(', ')}.
- \`packages/reactc-ui\`: React components for native window chrome and forms.
- \`templates/\`: project templates for \`${exe} new\`. A generated project's
  \`build.ps1\` and npm scripts use this compiler.
`);

// 5. Self-test: the packaged compiler creates a project from its template in an
// unrelated folder and builds it, finding its runtime through the executable.
if (args.includes('--no-self-test') || (packageOs === 'windows') !== windows) {
  console.log(`
reactc ${version} packaged in ${out} (no self-test)`);
  process.exit(0);
}
const scratch = mkdtempSync(join(tmpdir(), 'reactc-package-'));
const packaged = join(out, 'bin', exe);
// a project from the packaged template, its client bundled
const project = join(scratch, 'app');
run(packaged, ['new', project], { cwd: scratch });
run(packaged, ['build', join(project, 'client', 'App.tsx'), '--http-origin', 'http://127.0.0.1:5180',
  '--outdir', join(scratch, 'bundle')], { cwd: scratch });
if (!existsSync(join(scratch, 'bundle', 'app.cjs'))) throw new Error('The packaged compiler produced no bundle');
if (args.includes('--smoke-native')) {
  // its server (node:http and @reactc/threads) compiled to a native executable
  const target = packageOs === 'windows' ? 'windows' : 'host';
  run(packaged, ['build', join(project, 'server', 'index.ts'), '--server', '--target', target,
    '--name', 'PackagedServer', '--outdir', join(scratch, 'native')], { cwd: scratch });
  const binary = join(scratch, 'native', packageOs === 'windows' ? 'PackagedServer.exe' : 'PackagedServer');
  if (!existsSync(binary)) throw new Error('The packaged compiler produced no executable');
  console.log('Native self-test built ' + binary);
}
rmSync(scratch, { recursive: true, force: true });
console.log(`\nreactc ${version} packaged in ${out}\n  ${join(out, 'bin', exe)}`);
