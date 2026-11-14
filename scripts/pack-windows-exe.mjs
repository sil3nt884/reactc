// Usage: node scripts/pack-windows-exe.mjs COMPILER TOOLCHAIN_ZIP OUTPUT [RELEASE_TAG]
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const [compiler, archive, output, tag] = process.argv.slice(2);
if (!compiler || !archive || !output || (tag && !/^v[0-9][A-Za-z0-9._+-]*$/.test(tag))) {
  throw new Error('Usage: pack-windows-exe.mjs COMPILER TOOLCHAIN_ZIP OUTPUT [RELEASE_TAG]');
}
if ([compiler, archive].some(input => resolve(input) === resolve(output))) {
  throw new Error('The output must be distinct from the compiler and archive inputs');
}

const hash = createHash('sha256');
const temp = output + '.tmp-' + process.pid;
const handle = await open(temp, 'wx');
try {
  const write = async bytes => {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes.subarray(offset));
      if (!bytesWritten) throw new Error('could not write standalone executable');
      offset += bytesWritten;
    }
  };
  for await (const chunk of createReadStream(compiler)) await write(chunk);
  let archiveSize = 0n;
  for await (const chunk of createReadStream(archive)) {
    hash.update(chunk);
    archiveSize += BigInt(chunk.length);
    if (!tag) await write(chunk);
  }
  if (!archiveSize) throw new Error('the toolchain archive is empty');
  const url = Buffer.from(tag
    ? `https://github.com/sil3nt884/reactc/releases/download/${encodeURIComponent(tag)}/reactc-windows-x64.zip`
    : '');
  await write(url);
  const footer = Buffer.alloc(56);
  footer.writeBigUInt64LE(tag ? 0n : archiveSize, 0);
  footer.writeBigUInt64LE(BigInt(url.length), 8);
  hash.digest().copy(footer, 16);
  footer.write('RCTPACK1', 48);
  await write(footer);
  await handle.close();
  await rename(temp, output);
} finally {
  await handle.close();
  await rm(temp, { force: true });
}
console.log(`${output} (${(await stat(output)).size} bytes)`);
