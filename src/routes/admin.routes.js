const express = require("express");
const { isValidVisitorId } = require("../utils/visitor");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

// Admin dashboard API (read-only). Mounted behind requireAdmin
// (Authorization: Bearer <token from /api/admin/auth/verify-otp>).
//
// Common query parameters for lists:
//   page   (default 1), limit (default 20, max 100)
//   search text (see each route)
//   from, to  ISO dates, e.g. 2026-11-01 or 2026-11-24T10:00:00Z
function createAdminRouter({ visitors, now = () => new Date() }) {
  const router = express.Router();
  // Personal data: never cache.
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const listParams = (query) => {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";
    const date = (value, endOfDay) => {
      if (typeof value !== "string" || !value) return undefined;
      // A plain date ("2026-11-24") as `to` includes that whole day.
      const text = /^\d{4}-\d{2}-\d{2}$/.test(value) && endOfDay ? `${value}T23:59:59.999Z` : value;
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const from = date(query.from, false);
    const to = date(query.to, true);
    return { page, limit, search, from, to, invalidDate: from === null || to === null };
  };

  // GET /api/admin/stats → totals and the last 24 hours
  router.get("/stats", async (req, res) => {
    const stats = await visitors.stats({ now: now() });
    return sendResponse(res, 200, false, "Dashboard stats", stats);
  });

  // GET /api/admin/capsules?search=&from=&to=&page=&limit=
  // One row per Event Capsule: eventName, eventDate, email, name, visitorId,
  // webLink, shortCode, status, createdAt. search: event name, shortCode,
  // visitorId or email. from/to: when the capsule was created.
  router.get("/capsules", async (req, res) => {
    const params = listParams(req.query);
    if (params.invalidDate) return sendResponse(res, 400, true, "from/to must be dates like 2026-11-24");
    const result = await visitors.listCapsules(params);
    return sendResponse(res, 200, false, "Event capsules", result);
  });

  // GET /api/admin/visitors?search=&signedIn=true|false&from=&to=&page=&limit=
  // One row per visitor (browser), most recently active first, with the
  // signed-in account (user) and capsules created from that browser.
  // search: visitorId or email. from/to: last activity.
  router.get("/visitors", async (req, res) => {
    const params = listParams(req.query);
    if (params.invalidDate) return sendResponse(res, 400, true, "from/to must be dates like 2026-11-24");
    const signedIn = req.query.signedIn === "true" ? true : req.query.signedIn === "false" ? false : undefined;
    const result = await visitors.listVisitors({ ...params, signedIn });
    return sendResponse(res, 200, false, "Visitors", result);
  });

  // GET /api/admin/visitors/:visitorId → the visitor, account, capsules and latest events
  router.get("/visitors/:visitorId", async (req, res) => {
    const { visitorId } = req.params;
    if (!isValidVisitorId(visitorId)) return sendResponse(res, 400, true, "Invalid visitorId");
    const visitor = await visitors.getVisitor(visitorId);
    if (!visitor) return sendResponse(res, 404, true, "Visitor not found");
    return sendResponse(res, 200, false, "Visitor", visitor);
  });

  return router;
}

module.exports = { createAdminRouter };
