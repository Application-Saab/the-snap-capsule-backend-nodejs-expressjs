const mongoose = require("mongoose");

// One active login code per email. The code itself is never stored, only an
// HMAC of it, so a database leak doesn't reveal valid codes.
const otpCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },

    // Resend limits: how many codes were sent since windowStart (1 hour).
    sendCount: { type: Number, default: 1 },
    windowStart: { type: Date, required: true },
    lastSentAt: { type: Date, required: true },

    // MongoDB deletes the document automatically after this time.
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true }
);

otpCodeSchema.index({ email: 1 }, { unique: true });
otpCodeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OtpCode || mongoose.model("OtpCode", otpCodeSchema);
