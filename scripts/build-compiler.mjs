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
//   tools/             Porffor, the C toolchain (run through WSL on Windows,
//                      or the native MinGW-w64 one), Skia and the native libraries
//   packages/reactc-ui, templates/node-react-app, README.md, VERSION.json
//
// --wasm also copies the WebAssembly toolchain (about 640 MB).
// --smoke-native also compiles a native executable with the packaged compiler.
//
// Release builds (see .github/workflows/release.yml):
//   --native-windows        package Windows-native tools, including Node/npm
//   --node-dir DIR         use this Windows Node distribution (default: current Node)
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
const nativeWindows = args.includes('--native-windows');
const nodeDir = resolve(option('--node-dir') ?? dirname(process.execPath));
if (nativeWindows && (!windows || packageOs !== 'windows' || args.includes('--wasm'))) {
  throw new Error('--native-windows requires Windows and packages the Windows x64 target only');
}
if (nativeWindows) {
  for (const path of ['node.exe', 'LICENSE', 'npm.cmd', 'node_modules/npm/bin/npm-cli.js']) {
    if (!existsSync(join(nodeDir, path))) throw new Error(`Missing ${path} in ${nodeDir}; use --node-dir with a Windows Node distribution`);
  }
  for (const path of ['mingw64/bin/gcc.exe', 'porffor/runtime/index.js', 'node-win/.native', 'ada-win/.native', 'http2-win/.native']) {
    if (!existsSync(join(toolsDir, path))) throw new Error(`Missing ${path} in ${toolsDir}; run npm run setup -- --native`);
  }
}

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

// 3. Tools. The Linux toolchain contains Linux symlinks and executables, so
// on Windows it is copied inside WSL. Copies are incremental.
// A Windows checkout set up with `npm run setup -- --native` has the native
// tools (MinGW-w64, Porffor's source), which are plain Windows files. With
// only those, the package builds Windows programs and needs no WSL.
const nativeTools = windows && packageOs === 'windows' && existsSync(join(toolsDir, 'mingw64', 'bin', 'gcc.exe'))
  ? ['mingw64', 'porffor'] : [];
if (nativeTools.length && existsSync(join(toolsDir, 'angle-win'))) nativeTools.push('angle-win');
const linuxToolchain = !nativeWindows && (nativeTools.length === 0 || existsSync(join(toolsDir, 'local')));
const tools = linuxToolchain
  ? ['porf', 'local', 'skia-win', 'node-win', 'ada-win', 'node-host', 'ada', 'http2-host', 'http2-win']
  : ['skia-win', 'node-win', 'ada-win', 'http2-win'];
if (existsSync(join(toolsDir, 'wasmtime-pack-windows', 'wasmtime.exe'))) tools.push('wasmtime-pack-windows');
if (linuxToolchain && args.includes('--wasm')) tools.push('wasi-sdk', 'wasmtime', 'wasmtime-c-linux', 'ada-wasi');
if (linuxToolchain && existsSync(join(toolsDir, 'wasmtime-pack-linux', 'wasmtime'))) tools.push('wasmtime-pack-linux');
// the Android runtime's C API is optional (it needs the Android NDK; see native/wasm/README.md)
if (linuxToolchain && args.includes('--wasm') && existsSync(join(toolsDir, 'wasmtime-c-android'))) tools.push('wasmtime-c-android');
if (!linuxToolchain && args.includes('--wasm')) throw new Error('--wasm needs the Linux toolchain: run npm run setup -- --wasm (WSL)');
for (const tool of tools) {
  if (!existsSync(join(toolsDir, tool))) throw new Error(`${join(toolsDir, tool)} is missing; run npm run setup (see tools/README.md)`);
}
console.log('Copying tools: ' + [...tools, ...nativeTools].join(', '));
if (linuxToolchain) {
  const sources = tools.map(tool => (windows ? wslPath(join(toolsDir, tool)) : join(toolsDir, tool)));
  const target = windows ? wslPath(join(out, 'tools')) : join(out, 'tools');
  const copyFlags = args.includes('--dereference') ? '-a -L -u' : '-a -u';
  const script = `mkdir -p ${quote(target)} && cp ${copyFlags} ${sources.map(quote).join(' ')} ${quote(target)}/`;
  if (windows) run('wsl.exe', ['-e', 'bash', '-c', script]);
  else run('sh', ['-c', script]);
}
for (const tool of [...(linuxToolchain ? [] : tools), ...nativeTools]) {
  // the compiler is large and pinned: copied once
  if (tool === 'mingw64' && existsSync(join(out, 'tools', 'mingw64', 'bin', 'gcc.exe'))) continue;
  rmSync(join(out, 'tools', tool), { recursive: true, force: true });
  cpSync(join(toolsDir, tool), join(out, 'tools', tool), {
    recursive: true,
    filter: source => !source.split(/[\\/]/).includes('.git'),
  });
}
tools.push(...nativeTools);
if (nativeWindows) {
  const target = join(out, 'tools', 'node');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(join(target, 'node_modules'), { recursive: true });
  for (const file of ['node.exe', 'LICENSE', 'npm.cmd']) cpSync(join(nodeDir, file), join(target, file));
  cpSync(join(nodeDir, 'node_modules', 'npm'), join(target, 'node_modules', 'npm'), { recursive: true });
  tools.push('node');
}
const requirements = packageOs === 'linux'
  ? 'This package includes the C toolchain, Node, and npm for Linux x86-64.\n' +
    'It requires glibc at least as new as Ubuntu 26.04\'s. Keep the extracted folder together.\n' +
    'Projects still need any npm dependencies they declare. Install them ahead of an offline build.'
  : nativeWindows
  ? 'This package includes the tools for Windows x64 builds, including Node and npm.\n' +
    'Keep the entire extracted folder together. Builds and generated apps run without WSL.'
  : nativeTools.length
  ? 'Builds of Windows programs use the bundled MinGW-w64 toolchain (`tools/mingw64`) and\n' +
    'run Porffor (`tools/porffor`) on Node 22.15 or newer, which must be on PATH (or\n' +
    'named by `REACTC_NODE`). They need no WSL.' +
    (linuxToolchain ? ' Linux targets run `tools/local` through WSL.' : '') +
    '\nThe produced executables need neither WSL nor Node.'
  : 'On Windows, builds run the bundled C toolchain (`tools/local`) through WSL\n' +
    'with an Ubuntu distribution. The produced executables do not need WSL.';
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
${exe} build${packageOs === 'windows' ? ' --target windows' : ''}                            # uses reactc.config.json in this folder
${exe} build --config path\\to\\reactc.config.json --only client
\`\`\`

Run \`${exe} build\` without arguments in a folder that has no configuration
to see every option.

## Requirements

${requirements}

reactc finds this folder from its executable. Set \`REACTC_HOME\` to use
another copy, or \`--root\` / \`"root"\` for a single build.

## Contents

- \`bin/\`: the compiler.
- \`src/\`, \`native/\`: the runtime and the Windows host compiled into every app.
- \`tools/\`: ${tools.join(', ')}.
- \`packages/reactc-ui\`: React components for native window chrome and forms.
- \`templates/\`: project templates for \`${exe} new\`. A generated project
  is built and run with \`${exe} build\` and \`${exe} start\`.
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
const linuxSmoke = packageOs === 'linux' && args.includes('--smoke-native');
const linuxEnv = { PATH: '/usr/bin:/bin', HOME: scratch, npm_config_offline: 'true' };
if (nativeWindows || linuxSmoke) {
  // A separate project, no compiler files or configuration pointing back at the checkout.
  const project = join(scratch, 'project with spaces');
  const source = join(project, 'src');
  mkdirSync(source, { recursive: true });
  const env = nativeWindows ? {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !['PATH', 'REACTC_HOME', 'REACTC_WSL', 'REACTC_NODE', 'PORFFOR_BIN', 'PORFFOR_SOURCE'].includes(key.toUpperCase()))),
    PATH: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
  } : linuxEnv;
  try {
    writeFileSync(join(project, 'reactc.config.json'), JSON.stringify({
      outDir: 'dist',
      client: { folders: ['src'], entry: 'src/App.tsx', name: 'PackagedApp' },
    }));
    // A local package exercises npm auto-install without requiring registry access.
    const dependency = join(project, 'dependency');
    mkdirSync(dependency);
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'smoke-label', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(dependency, 'index.js'), 'exports.label = "Packaged ReactC";\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: { 'smoke-label': 'file:dependency' } }));
    writeFileSync(join(source, 'App.tsx'), 'import { label } from "smoke-label";\nexport default function App() { return <main>{label}</main>; }\n');
    const target = nativeWindows ? 'windows' : 'linux';
    run(packaged, ['build', '--target', target], { cwd: project, env });
    const binary = join(project, 'dist', target, nativeWindows ? 'PackagedApp.exe' : 'app');
    if (!existsSync(binary)) throw new Error('The packaged compiler produced no executable');
    console.log('Native self-test built ' + binary + ' from reactc.config.json');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
  if (nativeWindows) {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(0);
  }
}
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
    '--name', 'PackagedServer', '--outdir', join(scratch, 'native')], { cwd: scratch, env: linuxSmoke ? linuxEnv : process.env });
  const binary = join(scratch, 'native', packageOs === 'windows' ? 'PackagedServer.exe' : 'PackagedServer');
  if (!existsSync(binary)) throw new Error('The packaged compiler produced no executable');
  console.log('Native self-test built ' + binary);
}
rmSync(scratch, { recursive: true, force: true });
console.log(`\nreactc ${version} packaged in ${out}\n  ${join(out, 'bin', exe)}`);
