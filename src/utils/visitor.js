const crypto = require("crypto");
const { readCookie } = require("./sessionCookie");

// The visitor cookie. The website reads and writes the same name, so keep
// them in sync. Not httpOnly: the website's JavaScript reads it to send the
// visitorId with requests. It only holds a random ID, nothing personal.
const VISITOR_COOKIE = "sc_vid";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// Random IDs from the website (crypto.randomUUID) or this server.
// Letters, digits, "-" and "_" only, 8–64 characters.
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

/** Rough device type from the User-Agent header. */
function deviceTypeOf(userAgent = "") {
  const ua = userAgent.toLowerCase();
  if (!ua) return "unknown";
  if (/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless/.test(ua)) return "bot";
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

/** Trims a string to `max` characters; anything that isn't a non-empty string becomes undefined. */
function clip(value, max) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

module.exports = {
  VISITOR_COOKIE,
  isValidVisitorId,
  newVisitorId,
  visitorIdFrom,
  setVisitorCookie,
  deviceTypeOf,
  clip,
};
