// node:url for reactc servers on Windows: Porffor's module with Windows
// file URL conversion (drive letters, UNC hosts, backslashes), as in Node.
import * as base from 'node:url';
import { resolve } from './path.js';

export * from 'node:url';

export function fileURLToPath(input) {
  const url = typeof input === 'string' ? new URL(input) : input;
  if (url == null || typeof url.href !== 'string') {
    throw new TypeError('The "path" argument must be of type string or an instance of URL');
  }
  if (url.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  const pathname = url.pathname;
  for (let i = 0; i < pathname.length; i++) {
    if (pathname[i] === '%') {
      const third = pathname.charCodeAt(i + 2) | 0x20;
      if ((pathname[i + 1] === '2' && third === 102) || (pathname[i + 1] === '5' && third === 99)) {
        throw new TypeError('File URL path must not include encoded \\ or / characters');
      }
    }
  }
  const path = decodeURIComponent(pathname.split('/').join('\\'));
  if (url.hostname !== '') return '\\\\' + url.hostname + path;  // UNC: \\server\share\...
  const letter = path.charCodeAt(1) | 0x20;
  if (letter < 97 || letter > 122 || path[2] !== ':') throw new TypeError('File URL path must be absolute');
  return path.slice(1);
}

function encodePathChars(path) {
  return path.split('%').join('%25').split('\n').join('%0A').split('\r').join('%0D').split('\t').join('%09');
}

export function pathToFileURL(path) {
  if (typeof path !== 'string') throw new TypeError('The "path" argument must be of type string');
  if (path.startsWith('\\\\')) {
    // UNC path: \\server\share\resource -> file://server/share/resource
    const parts = path.slice(2).split('\\');
    if (parts.length < 2 || !parts[0] || !parts[1]) throw new TypeError('Invalid UNC path: ' + path);
    const url = new URL('file://' + parts[0]);
    url.pathname = encodePathChars(parts.slice(1).join('/'));
    return url;
  }
  let resolved = resolve(path);
  if ((path.endsWith('\\') || path.endsWith('/')) && !resolved.endsWith('\\')) resolved += '\\';
  const href = 'file:///' + encodePathChars(resolved.split('\\').join('/'))
    .split('?').join('%3F').split('#').join('%23');
  return new URL(href);
}

const url = { ...(base.default ?? base), fileURLToPath, pathToFileURL };
export default url;
