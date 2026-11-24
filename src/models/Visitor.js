const mongoose = require("mongoose");

// One row per browser that visits the website, signed in or not.
// The visitorId is created by the website (or by POST /api/track/visit) and
// kept in the `sc_vid` cookie. Once the visitor signs in, userId/email link
// the row to the account; capsules they create carry the same visitorId.
//
// No IP addresses are stored.
const utmSchema = new mongoose.Schema(
  {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String,
  },
  { _id: false }
);

const visitorSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, unique: true, index: true },

    // Signed-in account (latest one used in this browser).
    userId: { type: String, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    // Every account that has signed in from this browser.
    userIds: { type: [String], default: [] },

    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    visitCount: { type: Number, default: 0 },

    // Where the visitor came from (first visit) and what they looked at last.
    landingPage: { type: String, maxlength: 512 },
    referrer: { type: String, maxlength: 1024 },
    utm: { type: utmSchema, default: undefined },
    lastPage: { type: String, maxlength: 512 },

    // Browser details (no IP address).
    userAgent: { type: String, maxlength: 512 },
    deviceType: { type: String, enum: ["mobile", "tablet", "desktop", "bot", "unknown"], default: "unknown" },
    // Language/region picked on the website (e.g. "en-IN", "de"), else the browser's language.
    locale: { type: String, maxlength: 35 },

    loginMethod: { type: String, enum: ["google", "email"] },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Visitor || mongoose.model("Visitor", visitorSchema);
