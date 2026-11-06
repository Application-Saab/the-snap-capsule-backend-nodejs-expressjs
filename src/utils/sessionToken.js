const jwt = require("jsonwebtoken");

const ISSUER = "thesnapcapsule-api";
const AUDIENCE = "thesnapcapsule-web";

function signSessionToken(userId, { secret, expiresIn }) {
  return jwt.sign({}, secret, {
    subject: String(userId),
    expiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
  });
}

// Returns the user ID, or throws if the token is invalid or expired.
function verifySessionToken(token, { secret }) {
  const payload = jwt.verify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  return payload.sub;
}

module.exports = { signSessionToken, verifySessionToken };
