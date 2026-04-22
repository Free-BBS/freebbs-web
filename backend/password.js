const crypto = require("crypto");

const ALGORITHM = "pbkdf2_sha256";
const ITERATIONS = 310000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${ALGORITHM}$${ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, iterations, salt, hash] = String(storedHash || "").split("$");

  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) {
    return false;
  }

  const derived = crypto
    .pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST)
    .toString("hex");

  const left = Buffer.from(derived, "hex");
  const right = Buffer.from(hash, "hex");

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  hashPassword,
  verifyPassword
};
