// Start a new project from a reactc template, using this checkout's reactc:
//
//   npm run new-app -- C:\path\to\my-app [--template node-react-app]
//
// The same as `reactc new`; a packaged compiler (npm run build:compiler) has
// it as `dist\reactc\bin\reactc.exe new`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'reactc.exe' : 'reactc';
const reactc = join(checkout, 'compiler', 'target', 'debug', exe);
if (!existsSync(reactc)) {
  console.log('Building reactc (first run only)...');
  const cargo = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(checkout, 'compiler', 'Cargo.toml')],
    { stdio: 'inherit' });
  if (cargo.status !== 0) process.exit(cargo.status ?? 1);
}
const result = spawnSync(reactc, ['new', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
