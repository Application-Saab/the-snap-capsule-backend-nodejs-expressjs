const { verifySessionToken } = require("../utils/sessionToken");
const { HttpError } = require("../utils/httpError");

// Protects a route: requires `Authorization: Bearer <session token>` and
// puts the signed-in user on req.user.
function createRequireAuth({ config, users }) {
  return async function requireAuth(req, res, next) {
    const header = req.get("authorization") || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return next(new HttpError(401, "Please sign in to continue.", "UNAUTHENTICATED"));
    }

    let userId;
    try {
      userId = verifySessionToken(token, { secret: config.JWT_SECRET });
    } catch {
      return next(new HttpError(401, "Your session has expired. Please sign in again.", "UNAUTHENTICATED"));
    }

    const user = await users.findById(userId);
    if (!user) {
      return next(new HttpError(401, "Please sign in to continue.", "UNAUTHENTICATED"));
    }
    req.user = user;
    return next();
  };
}

module.exports = { createRequireAuth };
