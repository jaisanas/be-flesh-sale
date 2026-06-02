const { staticApiToken } = require("../config");

module.exports = function staticTokenAuth(req, res, next) {
  if (!staticApiToken) {
    return res.status(500).json({ message: "STATIC_API_TOKEN is not configured" });
  }

  const authHeader = req.headers.authorization || "";
  const expectedValue = `Bearer ${staticApiToken}`;

  if (authHeader !== expectedValue) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return next();
};
