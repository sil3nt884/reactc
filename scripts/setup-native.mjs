// The WSL-free Windows setup: installs what reactc needs to build Windows
// programs (.exe) on Windows itself.
//
//   npm run setup -- --native
//
// Needs Rust (cargo), Node 22.15 or newer and Git for Windows (its sh.exe
// runs the tools/install-*.sh scripts). It installs, skipping what is there:
//
//   tools/mingw64    MinGW-w64 GCC (winlibs build), with cmake and ninja
//   tools/porffor    Porffor's source at the pinned commit; it runs on Node
//                    (src/porffor-node.mjs) in place of the Linux binary
//   tools/node-win   libuv, zlib, Brotli, zstd, uSockets and OpenSSL
//   tools/ada-win, tools/http2-win, tools/skia-win
//
// Linux (--target host) and WebAssembly targets still need the WSL setup
// (npm run setup); both can be installed side by side.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, 'tools');
const downloads = join(tools, '.download');

const MINGW = {
  url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/15.3.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-15.3.0-mingw-w64ucrt-14.0.0-r1.zip',
  sha256: 'ae31de2d5c1da830422b2b65384e3ad17f59c4daa8f11d9234e67090c32734e2',
};
// Git for Windows' perl cannot run OpenSSL's Configure, so OpenSSL comes
// prebuilt from MSYS2 (static, UCRT, like the toolchain above).
const OPENSSL = {
  url: 'https://repo.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-openssl-3.6.5-1-any.pkg.tar.zst',
  sha256: '773e021ebad83f14b5c103db467411e8ff064663e1c7e7f730e2be72f4117064',
};
const PORFFOR = { url: 'https://github.com/CanadaHonk/porffor.git', commit: 'a081ebd71177b898b2859298376e3191f088af32' };

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });
const step = text => console.log('\n== ' + text);
function must(command, args, options = {}) {
  const result = run(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

async function download({ url, sha256 }) {
  const file = join(downloads, url.slice(url.lastIndexOf('/') + 1));
  const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex');
  if (existsSync(file) && digest() === sha256) return file;
  console.log('Downloading ' + url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  const found = digest();
  if (found !== sha256) {
    rmSync(file);
    throw new Error(`${url}: SHA-256 is ${found}, expected ${sha256}`);
  }
  return file;
}

// bsdtar, which ships with Windows 10 and newer, reads .zip and .tar.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

function findSh() {
  const execPath = run('git', ['--exec-path']);
  const candidates = [];
  if (execPath.status === 0) {
    // <Git>/mingw64/libexec/git-core -> <Git>/usr/bin/sh.exe
    candidates.push(resolve(execPath.stdout.trim(), '..', '..', '..', 'usr', 'bin', 'sh.exe'));
  }
  candidates.push('C:\\Program Files\\Git\\usr\\bin\\sh.exe');
  return candidates.find(existsSync);
}

export async function setupNative() {
  if (process.platform !== 'win32') throw new Error('--native is the Windows setup; on Linux run npm run setup');
  const problems = [];
  if (run('cargo', ['--version']).status !== 0) {
    problems.push('Rust is not installed: get it from https://rustup.rs, then open a new terminal.');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 15)) {
    problems.push(`Node ${process.versions.node} is too old: Porffor runs on Node 22.15 or newer.`);
  }
  const sh = findSh();
  if (!sh) problems.push('Git for Windows is not installed (its sh.exe runs the install scripts): get it from https://git-scm.com.');
  if (!existsSync(tar)) problems.push(`${tar} is missing (Windows 10 version 1803 or newer includes it).`);
  if (problems.length) {
    console.error('Setup cannot continue yet:\n' + problems.map(problem => '  - ' + problem).join('\n'));
    process.exit(1);
  }
  mkdirSync(downloads, { recursive: true });

  const mingw = join(tools, 'mingw64');
  if (!existsSync(join(mingw, 'bin', 'gcc.exe'))) {
    step('MinGW-w64 GCC (tools/mingw64, a 270 MB download)');
    const archive = await download(MINGW);
    rmSync(mingw, { recursive: true, force: true });
    must(tar, ['-xf', archive, '-C', tools]);   // the archive's top folder is mingw64
  }

  const porffor = join(tools, 'porffor');
  if (!existsSync(join(porffor, 'runtime', 'index.js'))) {
    step('Porffor source (tools/porffor)');
    rmSync(porffor, { recursive: true, force: true });
    must('git', ['init', '-q', porffor]);
    must('git', ['-C', porffor, 'fetch', '--quiet', '--depth=1', PORFFOR.url, PORFFOR.commit]);
    must('git', ['-C', porffor, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  }

  // The install scripts run in Git's sh with the toolchain first on PATH.
  // It names its tools without the cross prefix the Linux toolchain uses.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'));
  const openssl = join(downloads, 'openssl');
  const env = {
    ...inherited,
    PATH: [join(mingw, 'bin'), dirname(sh), process.env.PATH].join(';'),
    WINDOWS_BIN_PREFIX: '', WINDOWS_CC: 'gcc', WINDOWS_CXX: 'g++', MAKE: 'mingw32-make',
    OPENSSL_PREFIX: join(openssl, 'ucrt64').replaceAll('\\', '/'),
    JOBS: process.env.JOBS ?? String(Math.max(2, Math.min(16, availableParallelism()))),
  };
  const script = (name, ...args) => must(sh, ['tools/' + name, ...args], { cwd: root, env });

  // Libraries the Linux toolchain built (the WSL setup) use another C
  // runtime, so each folder built here carries a marker and others are rebuilt.
  const built = name => existsSync(join(tools, name, '.native'));
  const mark = name => writeFileSync(join(tools, name, '.native'), 'built by scripts/setup-native.mjs with tools/mingw64\n');
  const fresh = name => rmSync(join(tools, name), { recursive: true, force: true });

  if (!built('node-win')) {
    step('Node native libraries for Windows (tools/node-win)');
    const archive = await download(OPENSSL);
    fresh('.download/openssl');
    mkdirSync(openssl);
    const unpacked = join(downloads, 'openssl.tar');
    writeFileSync(unpacked, zlib.zstdDecompressSync(readFileSync(archive)));
    must(tar, ['-xf', unpacked, '-C', openssl]);
    rmSync(unpacked);
    fresh('node-win');
    script('install-node-libs.sh', '--windows');
    mark('node-win');
  }
  if (!built('ada-win')) {
    step('URL parser for Windows (tools/ada-win)');
    fresh('ada-win');
    script('install-ada.sh', '--windows');
    mark('ada-win');
  }
  if (!built('http2-win')) {
    step('HTTP/2 library for Windows (tools/http2-win)');
    fresh('http2-win');
    script('install-http2.sh', '--windows');
    mark('http2-win');
  }
  if (!existsSync(join(tools, 'skia-win', 'libSkiaSharp.dll'))) {
    step('Skia for Windows UIs (tools/skia-win)');
    script('install-skia-windows.sh');
  }
  console.log('\nSetup complete: Windows programs now build without WSL.\nBuild the compiler with: npm run build:compiler');
}
