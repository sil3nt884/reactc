// Runs the pinned Porffor compiler from its source (tools/porffor) on Node.
// The WSL-free Windows build uses this in place of the Linux tools/porf
// binary: Porffor is written in JavaScript, and its released binaries are
// this same source compiled by itself.
//
//   node src/porffor-node.mjs c C:\app\dist\app.cjs -o C:\app\dist\app.c
//
// On Windows, Porffor sees every path the POSIX way, as in WSL
// (src/porffor-node-fs.mjs says why), so the C it writes is the C the Linux
// binary writes for the same files.
//
// PORFFOR_SOURCE names another checkout. Node 22.15 or newer.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toPosix } from './porffor-node-fs.mjs';

// The version a release build of the pinned commit reports. Upstream's
// release job writes it into runtime/index.js; a checkout carries a
// placeholder. reactc checks it in the header of the generated C.
const VERSION = 'alpha 22 (a081ebd 2026-11-05)';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.env.PORFFOR_SOURCE ?? join(here, '..', 'tools', 'porffor'));
const entry = join(source, 'runtime', 'index.js');
if (!existsSync(entry)) {
  console.error(`Porffor's source is not installed in ${source}: run "npm run setup -- --native"`);
  process.exit(1);
}
const entryUrl = pathToFileURL(entry).href;
const sourceUrl = pathToFileURL(source).href + '/';
const windows = process.platform === 'win32';
const posixFs = pathToFileURL(join(here, 'porffor-node-fs.mjs')).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (windows && (specifier === 'node:fs' || specifier === 'fs') && context.parentURL?.startsWith(sourceUrl)) {
      return { url: posixFs, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // `import x from './file' with { type: 'text' }`, which Node only reads
    // behind --experimental-import-text in newer releases.
    if (context.importAttributes?.type === 'text') {
      const text = readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)};` };
    }
    const loaded = nextLoad(url, context);
    if (url !== entryUrl) return loaded;
    const code = loaded.source.toString();
    const stamped = code.replace(/globalThis\.version = '.*?';/, `globalThis.version = '${VERSION}';`);
    if (stamped === code) throw new Error('porffor-node: the version line was not found in runtime/index.js');
    return { ...loaded, source: stamped };
  },
});

if (windows) {
  const cwd = process.cwd.bind(process);
  process.cwd = () => toPosix(cwd());
  process.argv = process.argv.map((argument, index) => (index < 2 ? argument : toPosix(argument)));
}
process.argv.splice(1, 1, entry);
await import(entryUrl);
