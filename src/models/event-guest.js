const mongoose = require("mongoose");

const eventGuestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "EventInvite", required: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    rsvpStatus: { type: String, enum: ["will Come", "Sure, will try", ""], default: "" },
  },
  {
    strict: false,
    timestamps: true,
  }
);

// Add unique index on userId and eventId combination
eventGuestSchema.index({ userId: 1, eventId: 1 }, { unique: true });
eventGuestSchema.index({ userId: 1 });

module.exports = mongoose.model("EventGuest", eventGuestSchema);