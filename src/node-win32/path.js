// node:path for reactc servers on Windows: Node's path.win32 semantics
// (backslashes, drive letters, UNC roots). Porffor's own path module is POSIX;
// it stays available as path.posix. Algorithms follow Node's lib/path.js.
import * as posixPath from 'node:path';

const CHAR_DOT = 46, CHAR_FORWARD_SLASH = 47, CHAR_BACKWARD_SLASH = 92, CHAR_COLON = 58, CHAR_QUESTION_MARK = 63;

function isPathSeparator(code) { return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH; }
function isWindowsDeviceRoot(code) { return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); }

function validateString(value, name) {
  if (typeof value !== 'string') throw new TypeError('The "' + name + '" argument must be of type string');
}

// Resolves . and .. segments; allowAboveRoot keeps leading .. for relative paths.
function normalizeString(path, allowAboveRoot, separator) {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (isPathSeparator(code)) break;
    else code = CHAR_FORWARD_SLASH;
    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // empty or "." segment
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 ||
            res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) { res = ''; lastSegmentLength = 0; }
            else { res = res.slice(0, lastSlashIndex); lastSegmentLength = res.length - 1 - res.lastIndexOf(separator); }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? separator + '..' : '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

// The root of a path: its length and device ("C:", "\\server\share") and
// whether it is absolute.
function parseRoot(path) {
  const len = path.length;
  let rootEnd = 0;
  let device = '';
  let isAbsolute = false;
  const code = path.charCodeAt(0);
  if (len === 1) {
    if (isPathSeparator(code)) { rootEnd = 1; isAbsolute = true; }
  } else if (isPathSeparator(code)) {
    isAbsolute = true;
    if (isPathSeparator(path.charCodeAt(1))) {
      let j = 2;
      let last = j;
      while (j < len && !isPathSeparator(path.charCodeAt(j))) j++;
      if (j < len && j !== last) {
        const firstPart = path.slice(last, j);
        last = j;
        while (j < len && isPathSeparator(path.charCodeAt(j))) j++;
        if (j < len && j !== last) {
          last = j;
          while (j < len && !isPathSeparator(path.charCodeAt(j))) j++;
          if (j === len || j !== last) {
            if (firstPart === '.' || firstPart === '?') {
              device = '\\\\' + firstPart;  // \\.\ and \\?\ device namespaces
              rootEnd = 4;
            } else if (j === len) {
              device = '\\\\' + firstPart + '\\' + path.slice(last);
              rootEnd = j;
            } else {
              device = '\\\\' + firstPart + '\\' + path.slice(last, j);
              rootEnd = j;
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else {
      rootEnd = 1;
    }
  } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    device = path.slice(0, 2);
    rootEnd = 2;
    if (len > 2 && isPathSeparator(path.charCodeAt(2))) { isAbsolute = true; rootEnd = 3; }
  }
  return { rootEnd, device, isAbsolute };
}

// Root length as dirname and parse count it: a UNC or device root includes
// its trailing separator (\\server\share\, \\?\C:\).
function rootLength(path) {
  const len = path.length;
  if (len === 0) return 0;
  const code = path.charCodeAt(0);
  if (len === 1) return isPathSeparator(code) ? 1 : 0;
  if (isPathSeparator(code)) {
    if (!isPathSeparator(path.charCodeAt(1))) return 1;
    let j = 2;
    let last = j;
    while (j < len && !isPathSeparator(path.charCodeAt(j))) j++;
    if (j < len && j !== last) {
      last = j;
      while (j < len && isPathSeparator(path.charCodeAt(j))) j++;
      if (j < len && j !== last) {
        last = j;
        while (j < len && !isPathSeparator(path.charCodeAt(j))) j++;
        if (j === len) return j;
        if (j !== last) return j + 1;
      }
    }
    return 1;
  }
  if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    return len > 2 && isPathSeparator(path.charCodeAt(2)) ? 3 : 2;
  }
  return 0;
}

export const sep = '\\';
export const delimiter = ';';

export function resolve(...args) {
  let resolvedDevice = '';
  let resolvedTail = '';
  let resolvedAbsolute = false;
  for (let i = args.length - 1; i >= -1; i--) {
    let path;
    if (i >= 0) {
      path = args[i];
      validateString(path, 'paths[' + i + ']');
      if (path.length === 0) continue;
    } else if (resolvedDevice.length === 0) {
      path = process.cwd();
    } else {
      // A drive-relative path resolves against that drive's current directory.
      path = process.env['=' + resolvedDevice] || process.cwd();
      if (path === undefined || (path.slice(0, 2).toLowerCase() !== resolvedDevice.toLowerCase() &&
          path.charCodeAt(2) === CHAR_BACKWARD_SLASH)) {
        path = resolvedDevice + '\\';
      }
    }
    const { rootEnd, device, isAbsolute: absolute } = parseRoot(path);
    if (device.length > 0) {
      if (resolvedDevice.length > 0) {
        if (device.toLowerCase() !== resolvedDevice.toLowerCase()) continue;
      } else {
        resolvedDevice = device;
      }
    }
    if (resolvedAbsolute) {
      if (resolvedDevice.length > 0) break;
    } else {
      resolvedTail = path.slice(rootEnd) + '\\' + resolvedTail;
      resolvedAbsolute = absolute;
      if (absolute && resolvedDevice.length > 0) break;
    }
  }
  resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, '\\');
  return resolvedAbsolute ? resolvedDevice + '\\' + resolvedTail : (resolvedDevice + resolvedTail) || '.';
}

export function normalize(path) {
  validateString(path, 'path');
  const len = path.length;
  if (len === 0) return '.';
  const { rootEnd, device, isAbsolute: absolute } = parseRoot(path);
  if (len === 1 && rootEnd === 1) return '\\';
  let tail = rootEnd < len ? normalizeString(path.slice(rootEnd), !absolute, '\\') : '';
  if (tail.length === 0 && !absolute) tail = '.';
  if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) tail += '\\';
  // A relative result must not read as a drive path (nodejs/node#56766).
  if (!absolute && device === '' && path.includes(':')) {
    if (tail.length >= 2 && isWindowsDeviceRoot(tail.charCodeAt(0)) && tail.charCodeAt(1) === CHAR_COLON) return '.\\' + tail;
    let index = path.indexOf(':');
    do {
      if (index === len - 1 || isPathSeparator(path.charCodeAt(index + 1))) return '.\\' + tail;
    } while ((index = path.indexOf(':', index + 1)) !== -1);
  }
  if (device === undefined || device === '') return absolute ? '\\' + tail : tail;
  return absolute ? device + '\\' + tail : device + tail;
}

export function isAbsolute(path) {
  validateString(path, 'path');
  const len = path.length;
  if (len === 0) return false;
  const code = path.charCodeAt(0);
  return isPathSeparator(code) ||
    (len > 2 && isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON && isPathSeparator(path.charCodeAt(2)));
}

export function join(...args) {
  if (args.length === 0) return '.';
  let joined;
  let firstPart;
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    validateString(arg, 'path');
    if (arg.length > 0) {
      if (joined === undefined) joined = firstPart = arg;
      else joined += '\\' + arg;
    }
  }
  if (joined === undefined) return '.';
  // Keep a UNC root only when the first part starts with exactly two separators.
  let needsReplace = true;
  let slashCount = 0;
  if (isPathSeparator(firstPart.charCodeAt(0))) {
    ++slashCount;
    const firstLen = firstPart.length;
    if (firstLen > 1 && isPathSeparator(firstPart.charCodeAt(1))) {
      ++slashCount;
      if (firstLen > 2) {
        if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
        else needsReplace = false;
      }
    }
  }
  if (needsReplace) {
    while (slashCount < joined.length && isPathSeparator(joined.charCodeAt(slashCount))) slashCount++;
    if (slashCount >= 2) joined = '\\' + joined.slice(slashCount);
  }
  return normalize(joined);
}

export function relative(from, to) {
  validateString(from, 'from');
  validateString(to, 'to');
  if (from === to) return '';
  const fromOrig = resolve(from);
  const toOrig = resolve(to);
  if (fromOrig === toOrig) return '';
  from = fromOrig.toLowerCase();
  to = toOrig.toLowerCase();
  if (from === to) return '';
  let fromStart = 0;
  while (fromStart < from.length && from.charCodeAt(fromStart) === CHAR_BACKWARD_SLASH) fromStart++;
  let fromEnd = from.length;
  while (fromEnd - 1 > fromStart && from.charCodeAt(fromEnd - 1) === CHAR_BACKWARD_SLASH) fromEnd--;
  const fromLen = fromEnd - fromStart;
  let toStart = 0;
  while (toStart < to.length && to.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) toStart++;
  let toEnd = to.length;
  while (toEnd - 1 > toStart && to.charCodeAt(toEnd - 1) === CHAR_BACKWARD_SLASH) toEnd--;
  const toLen = toEnd - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === CHAR_BACKWARD_SLASH) lastCommonSep = i;
  }
  if (i !== length) {
    if (lastCommonSep === -1) return toOrig;  // different drives or roots
  } else {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) return toOrig.slice(toStart + i + 1);
      if (i === 2) return toOrig.slice(toStart + i);
    }
    if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) lastCommonSep = i;
      else if (i === 2) lastCommonSep = 3;
    }
    if (lastCommonSep === -1) lastCommonSep = 0;
  }
  let out = '';
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) out += out.length === 0 ? '..' : '\\..';
  }
  toStart += lastCommonSep;
  if (out.length > 0) return out + toOrig.slice(toStart, toEnd);
  if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) ++toStart;
  return toOrig.slice(toStart, toEnd);
}

export function toNamespacedPath(path) {
  if (typeof path !== 'string' || path.length === 0) return path;
  const resolvedPath = resolve(path);
  if (resolvedPath.length <= 2) return path;
  if (resolvedPath.charCodeAt(0) === CHAR_BACKWARD_SLASH) {
    if (resolvedPath.charCodeAt(1) === CHAR_BACKWARD_SLASH) {
      const code = resolvedPath.charCodeAt(2);
      if (code !== CHAR_QUESTION_MARK && code !== CHAR_DOT) return '\\\\?\\UNC\\' + resolvedPath.slice(2);
    }
  } else if (isWindowsDeviceRoot(resolvedPath.charCodeAt(0)) && resolvedPath.charCodeAt(1) === CHAR_COLON &&
             resolvedPath.charCodeAt(2) === CHAR_BACKWARD_SLASH) {
    return '\\\\?\\' + resolvedPath;
  }
  return path;
}

export function dirname(path) {
  validateString(path, 'path');
  const len = path.length;
  if (len === 0) return '.';
  const rootEnd = rootLength(path);
  if (len === rootEnd) return path;
  let end = -1;
  let matchedSlash = true;
  for (let i = len - 1; i >= rootEnd; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) { end = i; break; }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === 0) return '.';
    end = rootEnd;
  }
  return path.slice(0, end);
}

export function basename(path, suffix) {
  if (suffix !== undefined) validateString(suffix, 'suffix');
  validateString(path, 'path');
  let start = 0;
  if (path.length >= 2 && isWindowsDeviceRoot(path.charCodeAt(0)) && path.charCodeAt(1) === CHAR_COLON) start = 2;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= start; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) { start = i + 1; break; }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return '';
  const base = path.slice(start, end);
  return suffix !== undefined && suffix.length > 0 && suffix !== base && base.endsWith(suffix)
    ? base.slice(0, base.length - suffix.length) : base;
}

export function extname(path) {
  validateString(path, 'path');
  let start = 0;
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  if (path.length >= 2 && path.charCodeAt(1) === CHAR_COLON && isWindowsDeviceRoot(path.charCodeAt(0))) start = startPart = 2;
  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (isPathSeparator(code)) {
      if (!matchedSlash) { startPart = i + 1; break; }
      continue;
    }
    if (end === -1) { matchedSlash = false; end = i + 1; }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 ||
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
    return '';
  }
  return path.slice(startDot, end);
}

export function parse(path) {
  validateString(path, 'path');
  const ret = { root: '', dir: '', base: '', ext: '', name: '' };
  if (path.length === 0) return ret;
  const len = path.length;
  const rootEnd = rootLength(path);
  if (rootEnd > 0) {
    ret.root = path.slice(0, rootEnd);
    if (rootEnd === len) { ret.dir = ret.root; return ret; }
  }
  const tail = path.slice(rootEnd);
  ret.base = basename(tail);
  ret.ext = extname(tail);
  ret.name = ret.ext ? ret.base.slice(0, ret.base.length - ret.ext.length) : ret.base;
  const dir = dirname(path);
  ret.dir = dir === '.' && rootEnd === 0 ? '' : dir;
  if (ret.dir === ret.root && rootEnd > 0 && ret.base === '') ret.dir = ret.root;
  return ret;
}

export function format(pathObject) {
  if (pathObject === null || typeof pathObject !== 'object') {
    throw new TypeError('The "pathObject" argument must be of type object');
  }
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || ((pathObject.name || '') + (pathObject.ext ? (pathObject.ext[0] === '.' ? '' : '.') + pathObject.ext : ''));
  if (!dir) return base;
  return dir === pathObject.root ? dir + base : dir + '\\' + base;
}

export function matchesGlob() {
  throw new Error('path.matchesGlob is not available in reactc servers');
}

const win32 = {
  sep, delimiter, resolve, normalize, isAbsolute, join, relative, toNamespacedPath, dirname, basename, extname,
  parse, format, matchesGlob,
};
win32.win32 = win32;
win32.posix = posixPath.default ?? posixPath;
export const posix = win32.posix;
export { win32 };
export default win32;
