const jwt = require("jsonwebtoken");

// The login session cookie. The website reads the same name when rendering
// pages on the server, so keep them in sync.
const SESSION_COOKIE = "sc_session";

/** Reads one cookie from the request's Cookie header ("" if missing). */
function readCookie(req, name) {
  const header = req.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return "";
}

// httpOnly: page JavaScript can't read it. SameSite=Lax: not sent with
// cross-site POSTs. Secure (HTTPS only) in production.
function cookieAttributes(config, maxAgeSeconds) {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (config.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Sets the session cookie; it expires together with the token. */
function setSessionCookie(res, config, token) {
  const { exp } = jwt.decode(token) || {};
  const maxAge = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 7 * 24 * 60 * 60;
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; ${cookieAttributes(config, maxAge)}`);
}

function clearSessionCookie(res, config) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttributes(config, 0)}`);
}

module.exports = { SESSION_COOKIE, readCookie, setSessionCookie, clearSessionCookie };
