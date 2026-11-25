const mongoose = require("mongoose");

// One row per browser that opens the website, logged in or not.
// visitorId is created by the website and kept in the `sc_vid` cookie.
// When the visitor logs in, userId/email link the row to the account.
// Capsules they create carry the same visitorId (folders.visitorId).
const visitorSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, unique: true, index: true },
    // Logged-in account (latest one used in this browser).
    userId: { type: String, index: true },
    email: { type: String, lowercase: true, trim: true },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Visitor || mongoose.model("Visitor", visitorSchema);
