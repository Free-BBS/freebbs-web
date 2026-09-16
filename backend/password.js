const crypto = require('crypto');

const ALGORITHM = 'pbkdf2_sha256';
const ITERATIONS = 310000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${ALGORITHM}$${ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, iterations, salt, hash] = String(storedHash || '').split('$');

  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) {
    return false;
  }

  const derived = crypto
    .pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST)
    .toString('hex');

  const left = Buffer.from(derived, 'hex');
  const right = Buffer.from(hash, 'hex');

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function verifyPasswordAsync(password, storedHash) {
  const [algorithm, iterations, salt, hash] = String(storedHash || '').split('$');

  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) {
    return false;
  }

  const derived = await new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, Number(iterations), KEY_LENGTH, DIGEST, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  const stored = Buffer.from(hash, 'hex');
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyPasswordAsync,
};
