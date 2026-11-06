const crypto = require("crypto");
const { HttpError } = require("../utils/httpError");

const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 5; // wrong guesses allowed per code
const RESEND_COOLDOWN_SECONDS = 60; // wait between codes for one email
const MAX_SENDS_PER_HOUR = 5; // codes per email per hour
const HOUR_MS = 60 * 60 * 1000;

function generateCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

// HMAC (not a plain hash) so the 1,000,000 possible codes can't be
// pre-computed from a leaked database without the server secret.
function hashCode(email, code, secret) {
  return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

function matches(expectedHex, actualHex) {
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(actualHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Creates a new code for `email`, stores its hash and emails it. */
async function requestOtp({ email, otps, mailer, config, now = new Date() }) {
  const existing = await otps.get(email);
  const inWindow = Boolean(existing) && now - existing.windowStart < HOUR_MS;

  if (existing) {
    const secondsSinceLast = (now - existing.lastSentAt) / 1000;
    if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
      const retryAfter = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast);
      throw new HttpError(429, `Please wait ${retryAfter} seconds before requesting a new code.`, "OTP_COOLDOWN", {
        retryAfter,
      });
    }
    if (inWindow && existing.sendCount >= MAX_SENDS_PER_HOUR) {
      const retryAfter = Math.ceil((existing.windowStart.getTime() + HOUR_MS - now.getTime()) / 1000);
      throw new HttpError(429, "Too many codes requested for this email. Please try again later.", "OTP_LIMIT", {
        retryAfter,
      });
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + config.OTP_TTL_MINUTES * 60 * 1000);
  const windowStart = inWindow ? existing.windowStart : now;

  await otps.upsert(email, {
    codeHash: hashCode(email, code, config.JWT_SECRET),
    expiresAt,
    attempts: 0,
    sendCount: inWindow ? existing.sendCount + 1 : 1,
    windowStart,
    lastSentAt: now,
    purgeAt: new Date(Math.max(expiresAt.getTime(), windowStart.getTime() + HOUR_MS)),
  });

  try {
    await mailer.sendOtp(email, code, config.OTP_TTL_MINUTES);
  } catch (err) {
    console.error("Failed to send login code email:", err.message);
    throw new HttpError(502, "We couldn't send the email right now. Please try again in a minute.", "EMAIL_SEND_FAILED");
  }

  return { expiresInMinutes: config.OTP_TTL_MINUTES, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
}

/** Checks `code` for `email`. Resolves on success; throws HttpError otherwise. */
async function verifyOtp({ email, code, otps, config, now = new Date() }) {
  const record = await otps.get(email);

  if (!record || record.expiresAt <= now) {
    if (record) await otps.remove(email);
    throw new HttpError(400, "This code has expired. Please request a new one.", "OTP_EXPIRED");
  }

  const counted = await otps.consumeAttempt(email, MAX_ATTEMPTS, now);
  if (!counted) {
    await otps.remove(email);
    throw new HttpError(400, "Too many incorrect attempts. Please request a new code.", "OTP_TOO_MANY_ATTEMPTS");
  }

  if (!matches(counted.codeHash, hashCode(email, code, config.JWT_SECRET))) {
    const attemptsLeft = MAX_ATTEMPTS - counted.attempts;
    if (attemptsLeft <= 0) {
      await otps.remove(email);
      throw new HttpError(400, "Too many incorrect attempts. Please request a new code.", "OTP_TOO_MANY_ATTEMPTS");
    }
    throw new HttpError(
      400,
      `That code isn't right. ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`,
      "OTP_INVALID",
      { attemptsLeft }
    );
  }

  // Each code works once.
  await otps.remove(email);
}

module.exports = {
  requestOtp,
  verifyOtp,
  generateCode,
  hashCode,
  OTP_LENGTH,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_HOUR,
};
