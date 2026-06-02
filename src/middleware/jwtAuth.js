const { verifyToken } = require("../utils/jwt");

module.exports = function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);

    if (payload.type !== "access") {
      return res.status(401).json({ message: "invalid token type" });
    }

    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ message: "invalid or expired token" });
  }
};
