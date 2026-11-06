const express = require("express");
const { z } = require("zod");
const { findOrCreateGoogleUser, findOrCreateEmailUser, toPublicUser } = require("../services/authService");
const { requestOtp, verifyOtp } = require("../services/otpService");
const { signSessionToken } = require("../utils/sessionToken");
const { createRequireAuth } = require("../middleware/requireAuth");
const { HttpError } = require("../utils/httpError");

const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email());

const googleBody = z.object({ credential: z.string().min(1).max(8192) });
const requestOtpBody = z.object({ email: emailField });
const verifyOtpBody = z.object({
  email: emailField,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

function createAuthRouter({ config, users, otps, mailer, verifyGoogleToken }) {
  const router = express.Router();
  const requireAuth = createRequireAuth({ config, users });

  const issueSession = (user) => ({
    success: true,
    token: signSessionToken(user.id, { secret: config.JWT_SECRET, expiresIn: config.JWT_EXPIRES_IN }),
    user: toPublicUser(user),
  });

  // ── Google ────────────────────────────────────────────────────────────
  // POST /api/auth/google  { credential: "<Google ID token>" } → { token, user }
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
    res.status(200).json(issueSession(user));
  });

  // ── Email one-time code ───────────────────────────────────────────────
  // POST /api/auth/email/request-otp  { email } → emails a 6-digit code
  router.post("/email/request-otp", async (req, res) => {
    const parsed = requestOtpBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Please enter a valid email address.", "INVALID_EMAIL");
    }
    const { email } = parsed.data;
    const result = await requestOtp({ email, otps, mailer, config });
    res.status(200).json({ success: true, message: `We've sent a 6-digit code to ${email}.`, email, ...result });
  });

  // POST /api/auth/email/verify-otp  { email, code } → { token, user }
  router.post("/email/verify-otp", async (req, res) => {
    const parsed = verifyOtpBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Please enter your email and the 6-digit code.", "INVALID_REQUEST");
    }
    const { email, code } = parsed.data;
    await verifyOtp({ email, code, otps, config });
    const user = await findOrCreateEmailUser(email, users);
    res.status(200).json(issueSession(user));
  });

  // ── Session ───────────────────────────────────────────────────────────
  // GET /api/auth/me  (Authorization: Bearer <token>) → { user }
  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ success: true, user: toPublicUser(req.user) });
  });

  return router;
}

module.exports = { createAuthRouter };
