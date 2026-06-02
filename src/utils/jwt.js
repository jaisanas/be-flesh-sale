const jwt = require("jsonwebtoken");
const { jwtSecret, jwtExpiresIn } = require("../config");

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

function generateTokenPair(userId) {
  const accessToken = jwt.sign({ userId, type: "access" }, jwtSecret, {
    expiresIn: jwtExpiresIn,
  });

  const refreshToken = jwt.sign({ userId, type: "refresh" }, jwtSecret, {
    expiresIn: jwtExpiresIn,
  });

  return { accessToken, refreshToken };
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

module.exports = {
  generateTokenPair,
  verifyToken,
};
