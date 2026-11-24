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

  // POST /api/track/visit
  // Body (all optional):
  //   { visitorId, path: "/", referrer, locale: "en-IN",
  //     utm: { source, medium, campaign, term, content } }
  // visitorId can also come from the X-Visitor-Id header or the sc_vid cookie.
  // If there is none, a new one is created and saved in the sc_vid cookie.
  // → { data: { visitorId, isNew, signedIn } }
  router.post("/visit", async (req, res) => {
    const user = await resolveSessionUser(req, { config, users });
    const { visitorId, isNew } = await tracker.recordVisit(req, res, user);
    return sendResponse(res, 200, false, "Visit recorded", { visitorId, isNew, signedIn: Boolean(user) });
  });

  return router;
}

module.exports = { createTrackRouter };
