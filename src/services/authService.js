const { HttpError } = require("../utils/httpError");

// Fields a client may see. Never expose provider IDs or internal fields.
function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    emailVerified: Boolean(user.emailVerified),
    avatarUrl: user.avatarUrl || null,
    createdAt: user.createdAt || null,
  };
}

/**
 * Finds or creates the user for a verified Google profile.
 *
 *  1. Same Google account signed in before → that user.
 *  2. Otherwise, a user with the same *verified* email exists (e.g. signed up
 *     with email OTP) → link this Google account to them.
 *  3. Otherwise → create a new user.
 */
async function findOrCreateGoogleUser(profile, users, now = new Date()) {
  const byGoogle = await users.findByGoogleId(profile.googleId);
  if (byGoogle) {
    return users.update(byGoogle.id, {
      lastLoginAt: now,
      name: byGoogle.name || profile.name,
      avatarUrl: profile.avatarUrl || byGoogle.avatarUrl,
    });
  }

  const trustedEmail = profile.emailVerified && profile.email ? profile.email : undefined;

  if (trustedEmail) {
    const byEmail = await users.findByEmail(trustedEmail);
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== profile.googleId) {
        // The email belongs to a user already linked to a different Google
        // account. Don't silently re-link; that could hand over the account.
        throw new HttpError(
          409,
          "This email is already linked to a different Google account. Please contact support.",
          "GOOGLE_ACCOUNT_CONFLICT"
        );
      }
      return users.update(byEmail.id, {
        googleId: profile.googleId,
        emailVerified: true,
        lastLoginAt: now,
        name: byEmail.name || profile.name,
        avatarUrl: byEmail.avatarUrl || profile.avatarUrl,
      });
    }
  }

  try {
    return await users.create({
      googleId: profile.googleId,
      email: trustedEmail,
      emailVerified: Boolean(trustedEmail),
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: now,
    });
  } catch (err) {
    // Two first-time sign-ins racing each other: the second insert hits the
    // unique index. The other request created the user, so just use it.
    if (err && err.code === 11000) {
      const existing = await users.findByGoogleId(profile.googleId);
      if (existing) return existing;
    }
    throw err;
  }
}

module.exports = { findOrCreateGoogleUser, toPublicUser };
