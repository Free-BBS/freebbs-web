const jwt = require("jsonwebtoken");
const config = require("./config");

function sign(payload) {
  const { exp, ...claims } = payload;
  const options = {
    algorithm: "HS256"
  };

  if (exp) {
    options.expiresIn = Math.max(1, Math.floor((exp - Date.now()) / 1000));
  }

  return jwt.sign(claims, config.authSecret, options);
}

function verify(token) {
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, config.authSecret, {
      algorithms: ["HS256"]
    });

    return {
      ...payload,
      exp: payload.exp ? payload.exp * 1000 : undefined
    };
  } catch {
    return null;
  }
}

module.exports = {
  sign,
  verify
};
