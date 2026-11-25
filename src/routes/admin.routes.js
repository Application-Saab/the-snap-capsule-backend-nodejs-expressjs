const express = require("express");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

// Admin panel API (read-only). Mounted behind requireAdmin (the admin
// panel's login token in the Authorization header).
function createAdminRouter({ visitors, now = () => new Date() }) {
  const router = express.Router();

  // A date ("2026-11-24") or date-time. A plain date as `to` includes that whole day.
  const parseDate = (value, endOfDay) => {
    if (typeof value !== "string" || !value) return undefined;
    const text = /^\d{4}-\d{2}-\d{2}$/.test(value) && endOfDay ? `${value}T23:59:59.999Z` : value;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  // GET /api/admin/users?page=1&limit=20&search=&from=&to=
  // Each website visitor, most recently active first:
  //   { visitorId, email (null if never logged in),
  //     capsules: [{ folderId, folderName, eventName, eventDate, shortCode, status, webLink, createdAt }] }
  // search: email, visitor ID, event name or short code.
  // from / to: when the visitor was last on the website.
  // summary: totals for the cards at the top of the admin page (whole site, not filtered).
  router.get("/users", async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    const from = parseDate(req.query.from, false);
    const to = parseDate(req.query.to, true);
    if (from === null || to === null) return sendResponse(res, 400, true, "from/to must be dates like 2026-11-24");

    const [list, summary] = await Promise.all([
      visitors.listUsers({ page, limit, search, from, to }),
      visitors.summary({ now: now() }),
    ]);
    res.set("Cache-Control", "no-store");
    return sendResponse(res, 200, false, "Users", { ...list, summary });
  });

  return router;
}

module.exports = { createAdminRouter };
