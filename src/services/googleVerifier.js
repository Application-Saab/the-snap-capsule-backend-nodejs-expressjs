const { OAuth2Client } = require("google-auth-library");

/**
 * Returns a function that verifies a Google ID token (the `credential` the
 * Google Sign-In button gives the browser) and returns the user's profile.
 *
 * verifyIdToken checks the token's signature against Google's public keys,
 * that it was issued by Google, that it hasn't expired, and that its
 * audience is our client ID — so a token minted for another app is rejected.
 */
function createGoogleVerifier(clientId) {
  const client = new OAuth2Client();

  return async function verifyGoogleIdToken(idToken) {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      throw new Error("Google token has no subject");
    }
    return {
      googleId: payload.sub,
      email: payload.email ? payload.email.toLowerCase() : undefined,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      avatarUrl: payload.picture,
    };
  };
}

module.exports = { createGoogleVerifier };
