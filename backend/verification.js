const crypto = require("crypto");

const CODE_TTL_MINUTES = 10;

function generateEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode(email, code) {
  return crypto
    .createHash("sha256")
    .update(`${String(email).toLowerCase()}::${code}`)
    .digest("hex");
}

function buildExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + CODE_TTL_MINUTES);
  return expiresAt;
}

module.exports = {
  CODE_TTL_MINUTES,
  buildExpiryDate,
  generateEmailCode,
  hashCode
};
