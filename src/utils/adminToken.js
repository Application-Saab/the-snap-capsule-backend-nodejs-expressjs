const jwt = require("jsonwebtoken");

// Dashboard sign-in tokens. A different audience from website sessions,
// so a customer's session token can never open the dashboard.
const ISSUER = "thesnapcapsule-api";
const AUDIENCE = "thesnapcapsule-admin";

function signAdminToken(email, { secret, hours }) {
  return jwt.sign({ role: "admin" }, secret, {
    subject: email,
    expiresIn: `${hours}h`,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
  });
}

// Returns { email, expiresAt }, or throws if the token is invalid or expired.
function verifyAdminToken(token, { secret }) {
  const payload = jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
  if (payload.role !== "admin" || !payload.sub) throw new Error("Not an admin token");
  return { email: payload.sub, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

module.exports = { signAdminToken, verifyAdminToken };
