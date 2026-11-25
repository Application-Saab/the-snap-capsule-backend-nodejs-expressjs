const crypto = require("crypto");
const { readCookie } = require("./sessionCookie");

// The visitor cookie. The website reads and writes the same name. Not
// httpOnly, so the website can send the visitorId with requests. It only
// holds a random ID, nothing personal.
const VISITOR_COOKIE = "sc_vid";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// Random IDs: letters, digits, "-" and "_", 8–64 characters.
const VISITOR_ID = /^[A-Za-z0-9_-]{8,64}$/;

const isValidVisitorId = (value) => typeof value === "string" && VISITOR_ID.test(value);
const newVisitorId = () => crypto.randomUUID();

/**
 * The visitorId sent with a request: body `visitorId`, then header
 * `X-Visitor-Id`, then the `sc_vid` cookie. "" if none is valid.
 */
function visitorIdFrom(req) {
  const candidates = [req.body && req.body.visitorId, req.get("x-visitor-id"), readCookie(req, VISITOR_COOKIE)];
  return candidates.find(isValidVisitorId) || "";
}

function setVisitorCookie(res, config, visitorId) {
  const parts = [`${VISITOR_COOKIE}=${visitorId}`, "Path=/", "SameSite=Lax", `Max-Age=${ONE_YEAR_SECONDS}`];
  if (config.NODE_ENV === "production") parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

module.exports = { VISITOR_COOKIE, isValidVisitorId, newVisitorId, visitorIdFrom, setVisitorCookie };
