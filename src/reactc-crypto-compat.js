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

  // Use OpenSSL's scrypt implementation, including its resource limits.
  if (typeof crypto.scryptSync !== 'function') {
    function deriveScrypt(password, salt, cost, blockSize, parallel, maxmem, output, length) {
      let ok = 0;
      Porffor.c`ok = (f64)EVP_PBE_scrypt((const char *)porf_crypto_in(password), porf_crypto_len(password),
        porf_crypto_in(salt), porf_crypto_len(salt), (uint64_t)porf_jv_val(cost),
        (uint64_t)porf_jv_val(blockSize), (uint64_t)porf_jv_val(parallel),
        (uint64_t)porf_jv_val(maxmem), (unsigned char *)porf_crypto_in(output), (size_t)porf_jv_val(length));`;
      return ok;
    }

    crypto.scryptSync = function scryptSync(password, salt, keylen, options) {
      const settings = options || {};
      const cost = settings.N ?? settings.cost ?? 16384;
      const blockSize = settings.r ?? settings.blockSize ?? 8;
      const parallel = settings.p ?? settings.parallelization ?? 1;
      const maxmem = settings.maxmem ?? 32 * 1024 * 1024;
      for (const [value, minimum] of [[cost, 2], [blockSize, 1], [parallel, 1], [maxmem, 1], [keylen, 0]]) {
        if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError('Invalid scrypt params');
      }
      const toBytes = value => {
        if (typeof value === 'string' || value instanceof ArrayBuffer) return Buffer.from(value);
        if (ArrayBuffer.isView(value)) return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        throw new TypeError('Expected a string or binary data');
      };
      const output = Buffer.alloc(keylen);
      if (!deriveScrypt(toBytes(password), toBytes(salt), cost, blockSize, parallel, maxmem, output, keylen)) {
        throw new RangeError('Invalid scrypt params');
      }
      return output;
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
