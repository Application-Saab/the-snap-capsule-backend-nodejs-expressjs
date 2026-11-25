const express = require("express");

// Admin panel API (read-only). Mounted behind requireAdmin (the admin
// panel's login token in the Authorization header).
function createAdminRouter({ visitors }) {
  const router = express.Router();

  // GET /api/admin/users?page=1&limit=20
  // Each website visitor, most recently active first:
  //   { visitorId, email (null if never logged in),
  //     capsules: [{ folderId, folderName, eventName, eventDate, shortCode, status, webLink, createdAt }] }
  router.get("/users", async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const data = await visitors.listUsers({ page, limit });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ error: false, status: 200, message: "Users", data });
  });

  return router;
}

module.exports = { createAdminRouter };
