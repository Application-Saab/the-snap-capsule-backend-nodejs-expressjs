const { visitorIdFrom, newVisitorId, setVisitorCookie } = require("../utils/visitor");

// Visitor tracking: every browser gets a visitorId; at login it's linked to
// the account's email. Tracking must never break login, so login() logs
// failures instead of throwing.
function createTracker({ config, visitors, now = () => new Date() }) {
  // The request's visitorId, or a new one (also saved in the sc_vid cookie).
  const ensureVisitorId = (req, res) => {
    const existing = visitorIdFrom(req);
    if (existing) return existing;
    const visitorId = newVisitorId();
    setVisitorCookie(res, config, visitorId);
    return visitorId;
  };

  const userOf = (user) => (user ? { id: String(user.id), email: user.email } : null);

  return {
    /** POST /api/track/visit: saves the visitor (and the logged-in user, if any). Returns the visitorId. */
    async recordVisit(req, res, user) {
      const visitorId = ensureVisitorId(req, res);
      // Refresh the cookie so it lasts as long as the visitor keeps coming back.
      setVisitorCookie(res, config, visitorId);
      await visitors.saveVisitor({ visitorId, user: userOf(user), now: now() });
      return visitorId;
    },

    /** After a successful login: links the browser's visitorId to the account. */
    async login(req, res, user) {
      try {
        const visitorId = ensureVisitorId(req, res);
        await visitors.saveVisitor({ visitorId, user: userOf(user), now: now() });
      } catch (error) {
        console.error("Visitor tracking (login) failed:", error && error.message);
      }
    },
  };
}

module.exports = { createTracker };
