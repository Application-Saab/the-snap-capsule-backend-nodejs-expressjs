const { HttpError } = require("../utils/httpError");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The origin (scheme://host[:port]) a browser request came from: the Origin
// header, or failing that the Referer's origin. "" if neither is sent
// (server-to-server calls, curl, Postman).
function requestOrigin(req) {
  const origin = req.get("origin");
  if (origin && origin !== "null") return origin;
  const referer = req.get("referer");
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

const isAllowedOrigin = (config, origin) => config.corsOrigins.includes(origin);

/**
 * Blocks cross-site requests that change something: a POST/PUT/PATCH/DELETE
 * sent by a browser from another website (it has an Origin that isn't in
 * CORS_ORIGINS) is refused with 403. Requests without an Origin (servers,
 * curl, mobile apps) pass, since they can't ride on a visitor's cookie.
 */
function createOriginCheck({ config }) {
  return function originCheck(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = requestOrigin(req);
    if (origin && !isAllowedOrigin(config, origin)) {
      return next(new HttpError(403, "This request isn't allowed from this website.", "FORBIDDEN_ORIGIN"));
    }
    return next();
  };
}

module.exports = { createOriginCheck, requestOrigin, isAllowedOrigin, SAFE_METHODS };
