const { visitorIdFrom, newVisitorId, setVisitorCookie, deviceTypeOf, clip } = require("../utils/visitor");

// Visitor tracking: page views, sign-ins and capsules, all tied to the
// browser's visitorId. Tracking must never break sign-in or capsule
// creation, so login() and capsuleCreated() log failures instead of throwing.

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"];

function utmFrom(body) {
  const raw = body && typeof body.utm === "object" && body.utm ? body.utm : {};
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = clip(raw[key] ?? (body ? body[`utm_${key}`] : undefined), 200);
    if (value) utm[key] = value;
  }
  return Object.keys(utm).length ? utm : undefined;
}

// Paths only (no domain, no query string): "/weblink-gallery?galleryId=…" → "/weblink-gallery".
function pathFrom(value) {
  const path = clip(value, 512);
  if (!path) return undefined;
  const clean = path.split(/[?#]/)[0];
  return clean.startsWith("/") ? clean : undefined;
}

function createTracker({ config, visitors, now = () => new Date() }) {
  const browser = (req) => {
    const userAgent = clip(req.get("user-agent"), 512);
    return { userAgent, deviceType: deviceTypeOf(userAgent) };
  };

  // The request's visitorId, or a new one (also saved in the sc_vid cookie).
  const ensureVisitorId = (req, res) => {
    const existing = visitorIdFrom(req);
    if (existing) return { visitorId: existing, created: false };
    const visitorId = newVisitorId();
    if (res) setVisitorCookie(res, config, visitorId);
    return { visitorId, created: true };
  };

  const safely = async (what, fn) => {
    try {
      await fn();
    } catch (error) {
      console.error(`Visitor tracking (${what}) failed:`, error && error.message);
    }
  };

  return {
    /**
     * POST /api/track/visit. Records a page view for the request's visitor
     * (creating the visitor ID if the browser has none) and links the
     * signed-in user if there is one. Returns { visitorId, isNew }.
     */
    async recordVisit(req, res, user) {
      const { visitorId, created } = ensureVisitorId(req, res);
      // Always refresh the cookie so it keeps living as long as the visitor comes back.
      if (!created) setVisitorCookie(res, config, visitorId);
      const body = req.body || {};
      const path = pathFrom(body.path);
      const { visitor, isNew } = await visitors.recordVisit({
        visitorId,
        now: now(),
        path,
        referrer: clip(body.referrer, 1024),
        utm: utmFrom(body),
        locale: clip(body.locale, 35) || clip((req.get("accept-language") || "").split(",")[0], 35),
        user: user ? { id: String(user.id), email: user.email } : null,
        ...browser(req),
      });
      await visitors.addEvent({
        visitorId,
        type: "page_view",
        path,
        ...(user ? { userId: String(user.id), email: user.email } : {}),
      });
      return { visitorId, isNew, visitor };
    },

    /** After a successful sign-in: links the browser's visitor to the account. */
    async login(req, res, user, method) {
      await safely("login", async () => {
        const { visitorId } = ensureVisitorId(req, res);
        const userId = String(user.id);
        await visitors.linkUser({ visitorId, user: { id: userId, email: user.email }, method, now: now(), ...browser(req) });
        await visitors.addEvent({ visitorId, type: "login", method, userId, email: user.email });
      });
    },

    /** After a capsule is created: adds it to the visitor's timeline. */
    async capsuleCreated(req, user, folder) {
      await safely("capsule", async () => {
        const visitorId = folder.visitorId || visitorIdFrom(req);
        if (!visitorId) return;
        await visitors.addEvent({
          visitorId,
          type: "capsule_created",
          userId: String(user.id),
          email: user.email,
          folderId: String(folder._id),
        });
      });
    },
  };
}

module.exports = { createTracker };
