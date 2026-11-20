const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    profileImageUrl: { type: String, default: "" },
    phone: { type: String, default: "" },
  },
  { _id: false }
);

const chatRoomSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "EventInvite" },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "EventInvite" },

    roomProfileUrl: { type: String, default: "" },
    roomName: { type: String, required: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    roomType: {
      type: String,
      enum: ["group", "direct"],
      default: "group",
    },

    directKey: {
      type: String,
      default: null,
    },

    members: {
      type: [memberSchema],
      validate: {
        validator: function (members) {
          const ids = members.map((m) => String(m.userId));
          return ids.length === new Set(ids).size;
        },
        message: "Duplicate members not allowed",
      },
    },

    lastReadAt: {
      type: Map,
      of: Date,
      default: {},
    },

    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// INDEXES

chatRoomSchema.index({ lastMessageAt: -1 });
chatRoomSchema.index({ "members.userId": 1, lastMessageAt: -1 });

// Direct room lookup
chatRoomSchema.index({
  roomType: 1,
  eventId: 1,
  "members.userId": 1,
});

// Unique direct room enforcement
chatRoomSchema.index(
  { directKey: 1 },
  {
    unique: true,
    partialFilterExpression: { roomType: "direct" },
  }
);

module.exports = mongoose.model("ChatRoom", chatRoomSchema);
