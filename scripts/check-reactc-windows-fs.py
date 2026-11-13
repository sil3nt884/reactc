"""Compile and execute a Windows React app that uses the three Node modules."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'host'))
from native_page import text_of

ENTRY = r'''import fs from 'node:fs';
import { readFile, writeFile, readdir, open } from 'node:fs/promises';
import { Readable } from 'node:stream';

function check(value, operation) {
  if (!value) throw new Error(operation);
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    let text = '';
    stream.on('data', part => { text += part; });
    stream.on('error', reject);
    stream.on('end', () => resolve(text));
  });
}

async function exercise() {
  const dir = 'native fs Ω 😀';
  const file = dir + '\\message-Ω.txt';
  const copy = dir + '/copy.txt';
  const bytes = dir + '/bytes.dat';
  const original = 'first\nΩ 😀\r\nlast';
  fs.mkdirSync(dir);
  check(fs.readdirSync(dir).length === 0, 'empty directory');
  fs.writeFileSync(file, original, 'utf8');
  check(fs.readFileSync(file, 'utf8') === original, 'sync Unicode read/write');
  const absolute = fs.realpathSync.native(file);
  check(/^[A-Za-z]:/.test(absolute) && fs.readFileSync(absolute, 'utf8') === original, 'native realpath');
  check(fs.statSync(file).isFile() && fs.statSync(dir).isDirectory(), 'stat');
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  check(entries.length === 1 && entries[0].name === 'message-Ω.txt' && entries[0].isFile(), 'sync Dirent');

  await writeFile(bytes, new Uint8Array([0, 10, 13, 26, 255]));
  const fd = fs.openSync(bytes, 'r+');
  try {
    const out = new Uint8Array(2);
    check(fs.readSync(fd, out, 0, 2, 2) === 2 && out[0] === 13 && out[1] === 26, 'positioned read');
    check(fs.writeSync(fd, new Uint8Array([254]), 0, 1, 4) === 1, 'positioned write');
    check(fs.readSync(fd, out, 0, 2, null) === 2 && out[0] === 0 && out[1] === 10, 'preserve descriptor offset');
    check(fs.fstatSync(fd).size === 5, 'fstat');
  } finally {
    fs.closeSync(fd);
  }
  const binary = await readFile(bytes);
  check(binary.length === 5 && binary[4] === 254, 'promise binary read/write');
  const handle = await open(bytes, 'r');
  try {
    check((await handle.stat()).size === 5, 'promise FileHandle');
  } finally {
    await handle.close();
  }

  check(await collect(Readable.from(['left', 'right'])) === 'leftright', 'Readable.from');
  check(await collect(fs.createReadStream(file, {encoding: 'utf8', highWaterMark: 3})) === original, 'file read stream');
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(copy);
    stream.on('error', reject);
    stream.on('close', resolve);
    stream.write('chunk\n');
    stream.end('Ω');
  });
  fs.renameSync(copy, dir + '/renamed.txt');
  fs.copyFileSync(dir + '/renamed.txt', copy);
  check(await fs.promises.readFile(copy, 'utf8') === 'chunk\nΩ', 'file write stream and copy');
  check((await readdir(dir)).length === 4, 'promise directory read');
  fs.appendFileSync(copy, '!');
  const copiedFd = fs.openSync(copy, 'r+');
  try {
    fs.fsyncSync(copiedFd);
    fs.ftruncateSync(copiedFd, 5);
  } finally {
    fs.closeSync(copiedFd);
  }
  check(fs.readFileSync(copy, 'utf8') === 'chunk', 'append, flush and truncate');
  fs.unlinkSync(copy);
  fs.mkdirSync(dir + '/empty');
  fs.rmdirSync(dir + '/empty');

  let missing;
  try { await readFile(copy); } catch (error) { missing = error.code; }
  check(missing === 'ENOENT', 'missing file rejection');
  return 'Filesystem and streams passed';
}

const report = exercise().catch(error => 'Filesystem probe failed: ' + error.message);
export default async function App() {
  return <main><p>{await report}</p></main>;
}
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reactc', type=Path)
    args = parser.parse_args()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='reactc-win-fs-', dir=dist) as temp:
        folder = Path(temp)
        entry = folder / 'probe.tsx'
        entry.write_text(ENTRY, encoding='utf-8')
        output = folder / 'build'
        subprocess.run([str(args.reactc.resolve()), 'build', str(entry.relative_to(ROOT)),
                        '--target', 'windows', '--async-page', '--name', 'FsProbe',
                        '--outdir', str(output.relative_to(ROOT))], cwd=ROOT, check=True, timeout=300)
        subprocess.run([str(output / 'FsProbe.exe'), '--smoke'], cwd=output, check=True, timeout=30)
        snapshot = json.loads((output / 'native-app-smoke.json').read_text(encoding='utf-8'))
        result = text_of(snapshot['tree'])
        assert result == 'Filesystem and streams passed', result
        files = output / 'native fs Ω 😀'
        assert (files / 'message-Ω.txt').read_bytes() == 'first\nΩ 😀\r\nlast'.encode()
        assert (files / 'bytes.dat').read_bytes() == bytes([0, 10, 13, 26, 254])
        assert (files / 'renamed.txt').read_bytes() == 'chunk\nΩ'.encode()
        assert not (files / 'copy.txt').exists()
    print('PASS: Windows native fs, fs/promises and streams, with actual Unicode paths and binary files')


if __name__ == '__main__':
    main()
