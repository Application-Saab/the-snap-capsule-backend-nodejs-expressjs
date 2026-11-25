const express = require("express");
const { createOriginCheck } = require("../middleware/originCheck");
const { resolveSessionUser } = require("../middleware/requireAuth");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

// Visitor tracking for the website. Works signed in or not.
function createTrackRouter({ config, users, tracker }) {
  const router = express.Router();

  // Browser requests must come from our own sites (like login).
  router.use(createOriginCheck({ config }));

  // POST /api/track/visit  { visitorId }
  // visitorId can also come from the X-Visitor-Id header or the sc_vid cookie.
  // If there is none, a new one is created and saved in the sc_vid cookie.
  // If the visitor is logged in, their email is saved with it.
  // → { data: { visitorId, signedIn } }
  router.post("/visit", async (req, res) => {
    const user = await resolveSessionUser(req, { config, users });
    const visitorId = await tracker.recordVisit(req, res, user);
    return sendResponse(res, 200, false, "Visitor saved", { visitorId, signedIn: Boolean(user) });
  });

  return router;
}

module.exports = { createTrackRouter };
