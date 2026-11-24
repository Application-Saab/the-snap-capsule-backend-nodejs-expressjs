const mongoose = require("mongoose");

// What a visitor did, in order: page views, sign-ins, capsules created.
// Used for the visitor's timeline in the dashboard.
const EVENT_TYPES = ["page_view", "login", "capsule_created"];

const visitorEventSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    userId: { type: String, index: true },
    email: { type: String, lowercase: true, trim: true },
    path: { type: String, maxlength: 512 },
    // login: "google" | "email"
    method: { type: String },
    // capsule_created: the folder (galleryId)
    folderId: { type: String, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

visitorEventSchema.index({ visitorId: 1, createdAt: -1 });
visitorEventSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.models.VisitorEvent || mongoose.model("VisitorEvent", visitorEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
