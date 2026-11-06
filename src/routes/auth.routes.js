const express = require("express");
const { z } = require("zod");
const { findOrCreateGoogleUser, toPublicUser } = require("../services/authService");
const { signSessionToken } = require("../utils/sessionToken");
const { createRequireAuth } = require("../middleware/requireAuth");
const { HttpError } = require("../utils/httpError");

const googleBody = z.object({
  credential: z.string().min(1).max(8192),
});

function createAuthRouter({ config, users, verifyGoogleToken }) {
  const router = express.Router();
  const requireAuth = createRequireAuth({ config, users });

  // POST /api/auth/google  { credential: "<Google ID token>" }
  // → 200 { success, token, user }
  router.post("/google", async (req, res) => {
    const parsed = googleBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Missing Google credential.", "INVALID_REQUEST");
    }

    let profile;
    try {
      profile = await verifyGoogleToken(parsed.data.credential);
    } catch {
      throw new HttpError(401, "Google sign-in could not be verified. Please try again.", "INVALID_GOOGLE_TOKEN");
    }

    const user = await findOrCreateGoogleUser(profile, users);
    const token = signSessionToken(user.id, {
      secret: config.JWT_SECRET,
      expiresIn: config.JWT_EXPIRES_IN,
    });

    res.status(200).json({ success: true, token, user: toPublicUser(user) });
  });

  // GET /api/auth/me  (Authorization: Bearer <token>) → 200 { success, user }
  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ success: true, user: toPublicUser(req.user) });
  });

  return router;
}

module.exports = { createAuthRouter };
