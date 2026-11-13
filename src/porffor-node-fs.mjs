// node:fs as Porffor's compiler sees it when src/porffor-node.mjs runs it on
// Windows: paths are spelled the POSIX way, /mnt/c/... for C:\..., exactly as
// in WSL.
//
// Porffor's compiler handles paths as POSIX text, and writes the entry file's
// path into the program, where its runtime walks up it to "/". With Windows
// spellings its module resolver fails on relative imports and a compiled
// program can loop forever at startup. With this view it emits the same C as
// the Linux binary run through WSL.
const real = process.getBuiltinModule('node:fs');

/** /mnt/c/Users/x -> c:/Users/x; other paths are returned as they are. */
export function toHost(path) {
  if (typeof path !== 'string') return path;
  const match = /^\/mnt\/([a-z])(\/.*)?$/.exec(path);
  return match ? `${match[1]}:${match[2] ?? '/'}` : path;
}

/** C:\Users\x -> /mnt/c/Users/x; other paths are returned as they are. */
export function toPosix(path) {
  if (typeof path !== 'string') return path;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`.replace(/\/$/, '') : path;
}

// Calls whose second argument is also a path, and calls that return one.
const twoPaths = new Set(['renameSync', 'copyFileSync', 'cpSync', 'linkSync', 'symlinkSync']);
const returnsPath = new Set(['realpathSync', 'mkdtempSync', 'readlinkSync']);

const fs = Object.create(real);
for (const name of Object.keys(real)) {
  if (!name.endsWith('Sync') || typeof real[name] !== 'function') continue;
  fs[name] = (...args) => {
    args[0] = toHost(args[0]);
    if (twoPaths.has(name)) args[1] = toHost(args[1]);
    const result = real[name](...args);
    return returnsPath.has(name) ? toPosix(result) : result;
  };
}

export default fs;
// The compiler also reads the module namespace (`await import('node:fs')`).
export const {
  accessSync, appendFileSync, chmodSync, closeSync, constants, copyFileSync, cpSync, existsSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync,
  renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, writeSync,
} = fs;
