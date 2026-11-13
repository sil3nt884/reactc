// Node/OpenSSL implementation of the primitives used by pg's SCRAM client.
const crypto = require('node:crypto');

const hash = (name, input) => crypto.createHash(name).update(input).digest();
const md5 = async input => hash('md5', input).toString('hex');

module.exports = {
  md5,
  randomBytes: length => crypto.randomBytes(length),
  sha256: async input => hash('sha256', input),
  hashByName: async (name, input) => hash(name.toLowerCase().replace('-', ''), input),
  hmacSha256: async (key, message) => crypto.createHmac('sha256', new Uint8Array(key)).update(message).digest(),
  deriveKey: (password, salt, iterations) => new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }),
  async postgresMd5PasswordHash(user, password, salt) {
    const inner = await md5(password + user);
    return 'md5' + await md5(Buffer.concat([Buffer.from(inner), salt]));
  },
};
