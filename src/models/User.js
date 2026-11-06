const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120 },
    // Only stored when the identity provider confirms it is verified, so an
    // unverified address can never block its real owner from signing up.
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    emailVerified: { type: Boolean, default: false },
    avatarUrl: { type: String, maxlength: 2048 },

    // Stable Google account ID (the ID token's `sub`). Emails can change;
    // this never does, so it is the primary way Google users are matched.
    googleId: { type: String },

    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// Unique only when present: users who sign in another way (e.g. Apple or
// OTP later) won't have these fields.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
