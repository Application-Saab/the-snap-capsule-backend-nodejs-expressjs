const express = require("express");
const { z } = require("zod");
const { requestOtp, verifyOtp, OTP_LENGTH } = require("../services/otpService");
const { signAdminToken } = require("../utils/adminToken");
const { createOriginCheck } = require("../middleware/originCheck");
const { createRequireAdmin } = require("../middleware/requireAdmin");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

const emailBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const verifyBody = emailBody.extend({ code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)) });

// Dashboard sign-in: email + one-time code, only for emails in ADMIN_EMAILS.
// The token comes back in the response body (the dashboard runs on another
// website, so a cookie wouldn't reach this server) and is sent as
// `Authorization: Bearer <token>`.
function createAdminAuthRouter({ config, otps, mailer }) {
  const router = express.Router();
  const otpKey = (email) => `admin:${email}`;

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!config.adminEmails.length) return sendResponse(res, 404, true, "Not found");
    return next();
  });
  // Browser requests must come from the dashboard's own website.
  router.use(createOriginCheck({ config: { corsOrigins: config.adminOrigins } }));

  // POST /api/admin/auth/request-otp  { email } → emails a code
  router.post("/request-otp", async (req, res) => {
    const parsed = emailBody.safeParse(req.body);
    if (!parsed.success) return sendResponse(res, 400, true, "Please enter a valid email address.");
    const { email } = parsed.data;
    if (!config.adminEmails.includes(email)) {
      return sendResponse(res, 403, true, "This email doesn't have dashboard access.");
    }
    const result = await requestOtp({ email, key: otpKey(email), otps, mailer, config });
    return sendResponse(res, 200, false, `We've sent a ${OTP_LENGTH}-digit code to ${email}.`, {
      email,
      codeLength: OTP_LENGTH,
      ...result,
    });
  });

  // POST /api/admin/auth/verify-otp  { email, code } → { token, email, expiresAt }
  router.post("/verify-otp", async (req, res) => {
    const parsed = verifyBody.safeParse(req.body);
    if (!parsed.success) return sendResponse(res, 400, true, `Please enter your email and the ${OTP_LENGTH}-digit code.`);
    const { email, code } = parsed.data;
    if (!config.adminEmails.includes(email)) {
      return sendResponse(res, 403, true, "This email doesn't have dashboard access.");
    }
    await verifyOtp({ email, key: otpKey(email), code, otps, config });
    const token = signAdminToken(email, { secret: config.JWT_SECRET, hours: config.ADMIN_SESSION_HOURS });
    const expiresAt = new Date(Date.now() + config.ADMIN_SESSION_HOURS * 3600 * 1000).toISOString();
    console.log(`Dashboard sign-in: ${email}`);
    return sendResponse(res, 200, false, "Signed in", { token, email, expiresAt });
  });

  // GET /api/admin/auth/me → who is signed in
  router.get("/me", createRequireAdmin({ config }), (req, res) =>
    sendResponse(res, 200, false, "Signed in", req.admin)
  );

  return router;
}

module.exports = { createAdminAuthRouter };
