// Porffor provides the OpenSSL-backed synchronous operations. Supply callback
// entry points for packages that call or promisify them.
{
  const crypto = require('node:crypto');
  const { setImmediate } = require('node:timers');

  if (typeof crypto.generateKeyPair !== 'function') {
    function generateKeyPair(type, options, callback) {
      if (typeof options === 'function' && callback === undefined) {
        callback = options;
        options = undefined;
      }
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      setImmediate(() => {
        let pair;
        try {
          pair = crypto.generateKeyPairSync(type, options);
        } catch (error) {
          callback(error);
          return;
        }
        callback(null, pair.publicKey, pair.privateKey);
      });
    }

    generateKeyPair[Symbol.for('nodejs.util.promisify.customArgs')] = ['publicKey', 'privateKey'];
    crypto.generateKeyPair = generateKeyPair;
  }

  // scrypt (RFC 7914): PBKDF2-HMAC-SHA256 from Porffor's OpenSSL around ROMix
  // with the Salsa20/8 core, here in JavaScript compiled to native code.
  if (typeof crypto.scryptSync !== 'function') {
    const rotate = (value, bits) => (value << bits) | (value >>> (32 - bits));
    const salsa20_8 = (block, offset) => {
      let x0 = block[offset], x1 = block[offset + 1], x2 = block[offset + 2], x3 = block[offset + 3];
      let x4 = block[offset + 4], x5 = block[offset + 5], x6 = block[offset + 6], x7 = block[offset + 7];
      let x8 = block[offset + 8], x9 = block[offset + 9], x10 = block[offset + 10], x11 = block[offset + 11];
      let x12 = block[offset + 12], x13 = block[offset + 13], x14 = block[offset + 14], x15 = block[offset + 15];
      for (let round = 0; round < 8; round += 2) {
        x4 ^= rotate(x0 + x12, 7); x8 ^= rotate(x4 + x0, 9); x12 ^= rotate(x8 + x4, 13); x0 ^= rotate(x12 + x8, 18);
        x9 ^= rotate(x5 + x1, 7); x13 ^= rotate(x9 + x5, 9); x1 ^= rotate(x13 + x9, 13); x5 ^= rotate(x1 + x13, 18);
        x14 ^= rotate(x10 + x6, 7); x2 ^= rotate(x14 + x10, 9); x6 ^= rotate(x2 + x14, 13); x10 ^= rotate(x6 + x2, 18);
        x3 ^= rotate(x15 + x11, 7); x7 ^= rotate(x3 + x15, 9); x11 ^= rotate(x7 + x3, 13); x15 ^= rotate(x11 + x7, 18);
        x1 ^= rotate(x0 + x3, 7); x2 ^= rotate(x1 + x0, 9); x3 ^= rotate(x2 + x1, 13); x0 ^= rotate(x3 + x2, 18);
        x6 ^= rotate(x5 + x4, 7); x7 ^= rotate(x6 + x5, 9); x4 ^= rotate(x7 + x6, 13); x5 ^= rotate(x4 + x7, 18);
        x11 ^= rotate(x10 + x9, 7); x8 ^= rotate(x11 + x10, 9); x9 ^= rotate(x8 + x11, 13); x10 ^= rotate(x9 + x8, 18);
        x12 ^= rotate(x15 + x14, 7); x13 ^= rotate(x12 + x15, 9); x14 ^= rotate(x13 + x12, 13); x15 ^= rotate(x14 + x13, 18);
      }
      const words = [x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15];
      for (let i = 0; i < 16; i++) block[offset + i] = (block[offset + i] + words[i]) >>> 0;
    };
    // BlockMix over block[start .. start + 32r), using scratch (32r words).
    const blockMix = (block, start, scratch, r) => {
      const x = new Uint32Array(16);
      for (let i = 0; i < 16; i++) x[i] = block[start + (2 * r - 1) * 16 + i];
      for (let i = 0; i < 2 * r; i++) {
        for (let k = 0; k < 16; k++) x[k] ^= block[start + i * 16 + k];
        salsa20_8(x, 0);
        for (let k = 0; k < 16; k++) scratch[i * 16 + k] = x[k];
      }
      for (let i = 0; i < r; i++) {
        for (let k = 0; k < 16; k++) {
          block[start + i * 16 + k] = scratch[2 * i * 16 + k];
          block[start + (i + r) * 16 + k] = scratch[(2 * i + 1) * 16 + k];
        }
      }
    };
    const roMix = (block, start, r, cost) => {
      const size = 32 * r;
      const table = new Uint32Array(size * cost);
      const scratch = new Uint32Array(size);
      for (let i = 0; i < cost; i++) {
        for (let k = 0; k < size; k++) table[i * size + k] = block[start + k];
        blockMix(block, start, scratch, r);
      }
      for (let i = 0; i < cost; i++) {
        const j = block[start + (2 * r - 1) * 16] & (cost - 1);
        for (let k = 0; k < size; k++) block[start + k] ^= table[j * size + k];
        blockMix(block, start, scratch, r);
      }
    };
    crypto.scryptSync = function scryptSync(password, salt, keylen, options) {
      const settings = options || {};
      const cost = settings.N ?? settings.cost ?? 16384;
      const r = settings.r ?? settings.blockSize ?? 8;
      const p = settings.p ?? settings.parallelization ?? 1;
      const maxmem = settings.maxmem ?? 32 * 1024 * 1024;
      if (!Number.isInteger(cost) || cost < 2 || (cost & (cost - 1)) !== 0 || !Number.isInteger(r) || r < 1 ||
          !Number.isInteger(p) || p < 1 || !Number.isInteger(keylen) || keylen < 0) {
        throw new RangeError('Invalid scrypt params');
      }
      if (128 * cost * r > maxmem) throw new RangeError('Invalid scrypt params: memory limit exceeded');
      const bytes = crypto.pbkdf2Sync(password, salt, 1, p * 128 * r, 'sha256');
      const words = new Uint32Array(p * 32 * r);
      for (let i = 0; i < words.length; i++) {
        words[i] = (bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24)) >>> 0;
      }
      for (let i = 0; i < p; i++) roMix(words, i * 32 * r, r, cost);
      for (let i = 0; i < words.length; i++) {
        bytes[i * 4] = words[i] & 255;
        bytes[i * 4 + 1] = (words[i] >>> 8) & 255;
        bytes[i * 4 + 2] = (words[i] >>> 16) & 255;
        bytes[i * 4 + 3] = (words[i] >>> 24) & 255;
      }
      return crypto.pbkdf2Sync(password, bytes, 1, keylen, 'sha256');
    };
  }
  if (typeof crypto.scrypt !== 'function') {
    crypto.scrypt = function scrypt(password, salt, keylen, options, callback) {
      if (typeof options === 'function' && callback === undefined) {
        callback = options;
        options = undefined;
      }
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      setImmediate(() => {
        let key;
        try {
          key = crypto.scryptSync(password, salt, keylen, options);
        } catch (error) {
          callback(error);
          return;
        }
        callback(null, key);
      });
    };
  }

  if (typeof crypto.pbkdf2 !== 'function') {
    crypto.pbkdf2 = function pbkdf2(password, salt, iterations, keylen, digest, callback) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      setImmediate(() => {
        let key;
        try {
          key = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest);
        } catch (error) {
          callback(error);
          return;
        }
        callback(null, key);
      });
    };
  }
}
