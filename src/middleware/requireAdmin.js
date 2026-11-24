const crypto = require("crypto");

// Protects the admin dashboard API with the ADMIN_API_KEY secret, sent as
// the X-Admin-Key header. Call it from the dashboard's server (or a tool
// like Postman), never from code that runs in a visitor's browser, because
// anyone could read the key there.
// Without ADMIN_API_KEY the admin API is off and answers 404.
function createRequireAdmin({ config }) {
  const expected = config.ADMIN_API_KEY ? crypto.createHash("sha256").update(config.ADMIN_API_KEY).digest() : null;

  return function requireAdmin(req, res, next) {
    if (!expected) {
      return res.status(404).json({ error: true, status: 404, message: "Not found", data: null });
    }
    const given = crypto.createHash("sha256").update(req.get("x-admin-key") || "").digest();
    if (!crypto.timingSafeEqual(given, expected)) {
      return res.status(401).json({ error: true, status: 401, message: "Invalid admin key", data: null });
    }
    return next();
  };
}

module.exports = { createRequireAdmin };
