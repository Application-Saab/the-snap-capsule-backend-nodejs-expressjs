const { verifyAdminToken } = require("../utils/adminToken");

const deny = (res, status, message) => res.status(status).json({ error: true, status, message, data: null });

// Dashboard requests: `Authorization: Bearer <admin token>` from
// POST /api/admin/auth/verify-otp. The email in the token must still be in
// ADMIN_EMAILS, so removing someone from the list locks them out at once.
// Without ADMIN_EMAILS the dashboard API is off and answers 404.
function createRequireAdmin({ config }) {
  return function requireAdmin(req, res, next) {
    if (!config.adminEmails.length) return deny(res, 404, "Not found");
    const [scheme, token] = (req.get("authorization") || "").split(" ");
    if (scheme !== "Bearer" || !token) return deny(res, 401, "Please sign in to the dashboard.");
    let admin;
    try {
      admin = verifyAdminToken(token, { secret: config.JWT_SECRET });
    } catch {
      return deny(res, 401, "Your dashboard session has expired. Please sign in again.");
    }
    if (!config.adminEmails.includes(admin.email)) return deny(res, 403, "This email doesn't have dashboard access.");
    req.admin = admin;
    return next();
  };
}

module.exports = { createRequireAdmin };
