const mongoose = require("mongoose");

const FolderSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    folderName: {
      type: String,
      required: true,
      trim: true,
    },

    capsuleBannerImageUrl:{
      type: String,
    },

    viewedBy: [
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
],
    clickCount: {
      type: Number,
      default: 0
    },
    customerId: {
      type: String,
      required: true,
      index: true,
    },
    vendorId: {
      type: String,
      index: true,
    },
    eventId: {
      type: String,
      ref: "eventInvites",
      index: true,
    },
    orderId: {
      type: String,
      ref: "orders",
    },
    // Snap Capsule: browser (visitorId, sc_vid cookie) that created the
    // capsule, for visitor tracking. Not in Hora.
    visitorId: {
      type: String,
      index: true,
    },
    deviceTracking: [
      {
        userId: {
          type: String,
          index: true,
        },
        deviceType: {
          type: String,
          enum: ["ios", "android"],
        },
        trackedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    totalPersonCount: {
      type: Number,
      default: 0,
    },
    shortCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["processing", "done", "failed"],
      default: "processing"
    },
    subFolders: [
      {
        _id: {
          type: String,
          default: () => new mongoose.Types.ObjectId().toString(),
        },
        folderName: {
          type: String,
          required: true,
          trim: true,
        },
        type: {
          type: String,
          enum: ["my_photos", "others"],
          required: true,
        },
        userId: {
          type: String,
          required: true,
          index: true,
        },
        folderDp: {
          fileUrl: { type: String },
          thumbnailUrl: { type: String },
          s3Key: { type: String },
          thumbnailKey: { type: String }
        },

        personCount: {
          type: Number,
          default: 0,
        },

        isPersonFolder: {
          type: Boolean,
          default: false,
        },
        
        isLocker: {
    type: Boolean,
    default: false,
    },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    shareCapsuleCount: {
      type: Number,
      default: 0,
    },

    eventDate: { type: Date, default: '' },

    galleryFolders: [
      {
        galleryId: {
          type: String,
          required: true,
        },
        orderId:{
          type: String,
          default: "",
        },
        bannerImageUrl: {
          type: String,
          default: "",
        },
        selectedForBanner:{
          type: String,
          default: "",
        }
      },
    ],

    rawVideoClips: [
      {
        fileUrl: {
          type: String,
          required: true,
        },
        s3Key: {
          type: String,
          required: true,
        },
        fileName: String,
        fileType: String,
        submittedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

// Unique only when a folder has an orderId (sparse, like shortCode above).
// Snap Capsule folders have no order, and a plain unique index treats every
// missing orderId as the same value, so only the first folder could be saved.
// (Hora: { unique: true } without sparse.)
FolderSchema.index({ orderId: 1 }, { unique: true, sparse: true });


module.exports = mongoose.model("Folder", FolderSchema);
