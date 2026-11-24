const express = require("express");
const { z } = require("zod");
const { findOrCreateGoogleUser, findOrCreateEmailUser, toPublicUser } = require("../services/authService");
const { requestOtp, verifyOtp, OTP_LENGTH } = require("../services/otpService");
const { signSessionToken } = require("../utils/sessionToken");
const { createRequireAuth } = require("../middleware/requireAuth");
const { HttpError } = require("../utils/httpError");
const { setSessionCookie, clearSessionCookie } = require("../utils/sessionCookie");
const { createOriginCheck } = require("../middleware/originCheck");

const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email());

const googleBody = z.object({ credential: z.string().min(1).max(8192) });
const requestOtpBody = z.object({ email: emailField });
const verifyOtpBody = z.object({
  email: emailField,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)),
});

function createAuthRouter({ config, users, otps, mailer, verifyGoogleToken }) {
  const router = express.Router();
  const requireAuth = createRequireAuth({ config, users });

  // Login requests (and logout) from a browser must come from our own sites.
  router.use(createOriginCheck({ config }));

  // Signs the user in: sets the httpOnly session cookie, and returns the token
  // in the body only to callers without an Origin header (the website's
  // server, mobile apps, Postman). A browser gets the cookie alone, so page
  // JavaScript never sees the token.
  const issueSession = (req, res, user) => {
    const token = signSessionToken(user.id, { secret: config.JWT_SECRET, expiresIn: config.JWT_EXPIRES_IN });
    setSessionCookie(res, config, token);
    const body = { success: true, user: toPublicUser(user) };
    if (!req.get("origin")) body.token = token;
    return res.status(200).json(body);
  };

  // ── Google ────────────────────────────────────────────────────────────
  // POST /api/auth/google  { credential: "<Google ID token>" } → cookie + { user } (+ token, see issueSession)
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
    issueSession(req, res, user);
  });

  // ── Email one-time code ───────────────────────────────────────────────
  // POST /api/auth/email/request-otp  { email } → emails a login code (OTP_LENGTH digits)
  router.post("/email/request-otp", async (req, res) => {
    const parsed = requestOtpBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Please enter a valid email address.", "INVALID_EMAIL");
    }
    const { email } = parsed.data;
    const result = await requestOtp({ email, otps, mailer, config });
    res.status(200).json({ success: true, message: `We've sent a ${OTP_LENGTH}-digit code to ${email}.`, email, codeLength: OTP_LENGTH, ...result });
  });

  // POST /api/auth/email/verify-otp  { email, code } → { token, user }
  router.post("/email/verify-otp", async (req, res) => {
    const parsed = verifyOtpBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, `Please enter your email and the ${OTP_LENGTH}-digit code.`, "INVALID_REQUEST");
    }
    const { email, code } = parsed.data;
    await verifyOtp({ email, code, otps, config });
    const user = await findOrCreateEmailUser(email, users);
    issueSession(req, res, user);
  });

  // ── Session ───────────────────────────────────────────────────────────
  // GET /api/auth/me  (session cookie or Authorization: Bearer <token>) → { user }
  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ success: true, user: toPublicUser(req.user) });
  });

  // POST /api/auth/logout → clears the session cookie (always succeeds).
  router.post("/logout", (req, res) => {
    clearSessionCookie(res, config);
    res.status(200).json({ success: true, message: "Signed out." });
  });

  return router;
}

module.exports = { createAuthRouter };
