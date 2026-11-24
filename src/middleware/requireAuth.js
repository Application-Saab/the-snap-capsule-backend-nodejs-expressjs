const { verifySessionToken } = require("../utils/sessionToken");
const { HttpError } = require("../utils/httpError");
const { SESSION_COOKIE, readCookie } = require("../utils/sessionCookie");
const { requestOrigin, isAllowedOrigin, SAFE_METHODS } = require("./originCheck");

// Protects a route and puts the signed-in user on req.user. The session
// token is read from `Authorization: Bearer <token>` (servers, apps,
// Postman) or from the httpOnly session cookie (the website in a browser).
//
// A cookie is sent by the browser automatically, so a request that changes
// something and is signed in by cookie must also show it comes from one of
// our own sites (Origin/Referer in CORS_ORIGINS); otherwise another website
// could submit a form on the visitor's behalf.
function createRequireAuth({ config, users }) {
  return async function requireAuth(req, res, next) {
    const header = req.get("authorization") || "";
    const [scheme, bearer] = header.split(" ");
    const fromHeader = scheme === "Bearer" && bearer ? bearer : "";
    const token = fromHeader || readCookie(req, SESSION_COOKIE);
    if (!token) {
      return next(new HttpError(401, "Please sign in to continue.", "UNAUTHENTICATED"));
    }

    if (!fromHeader && !SAFE_METHODS.has(req.method) && !isAllowedOrigin(config, requestOrigin(req))) {
      return next(new HttpError(403, "This request isn't allowed from this website.", "FORBIDDEN_ORIGIN"));
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
    req.authVia = fromHeader ? "bearer" : "cookie";
    return next();
  };
}

module.exports = { createRequireAuth };
