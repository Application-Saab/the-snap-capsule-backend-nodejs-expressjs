const jwt = require("jsonwebtoken");

const deny = (res, status, message) => res.status(status).json({ error: true, status, message, data: null });

// Admin panel roles allowed to read Snap Capsule data. Hora's admin login
// (/api/admin/admin_signin) only issues tokens to role "admin".
const ADMIN_ROLES = new Set(["admin"]);

/** The token from `Authorization: Bearer <token>` or a bare `Authorization: <token>` (how the admin panel sends it). */
function tokenFrom(req) {
  const header = (req.get("authorization") || "").trim();
  if (!header) return "";
  const [scheme, value] = header.split(/\s+/);
  return /^bearer$/i.test(scheme) ? value || "" : header;
}

// Dashboard requests carry the admin panel's login token (localStorage
// "authToken", from Hora's /api/admin/admin_signin). It's checked with
// HORA_JWT_SECRET and must belong to an admin.
// Without HORA_JWT_SECRET the dashboard API is off and answers 404.
function createRequireAdmin({ config }) {
  return function requireAdmin(req, res, next) {
    if (!config.HORA_JWT_SECRET) return deny(res, 404, "Not found");
    const token = tokenFrom(req);
    if (!token) return deny(res, 401, "Please log in to the admin panel.");
    let payload;
    try {
      payload = jwt.verify(token, config.HORA_JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      return deny(res, 401, "Your admin session has expired. Please log in again.");
    }
    if (!payload || !ADMIN_ROLES.has(payload.role)) return deny(res, 403, "Only admins can view Snap Capsule data.");
    req.admin = { id: payload._id ? String(payload._id) : null, email: payload.email || null, name: payload.name || null };
    return next();
  };
}

module.exports = { createRequireAdmin, tokenFrom };
