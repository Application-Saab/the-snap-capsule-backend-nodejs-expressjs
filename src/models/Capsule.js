const mongoose = require("mongoose");

// One event capsule: a private space where the host and guests collect the
// photos from an event.
const capsuleSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    // Calendar date of the event, stored as midnight UTC. Always read and
    // write it as "YYYY-MM-DD" so it never shifts across time zones.
    eventDate: { type: Date, required: true },
    // Short random code for the guest link / QR code (e.g. /c/k3X9pQ2a).
    shareCode: { type: String, required: true },
  },
  { timestamps: true }
);

capsuleSchema.index({ owner: 1, createdAt: -1 });
capsuleSchema.index({ shareCode: 1 }, { unique: true });

module.exports = mongoose.models.Capsule || mongoose.model("Capsule", capsuleSchema);
