const mongoose = require("mongoose");
const Capsule = require("../models/Capsule");

// Database access for capsules. Returns plain records:
//   { id, ownerId, name, eventDate (Date), shareCode, createdAt, updatedAt }

function toRecord(doc) {
  if (!doc) return null;
  const { _id, __v, owner, ...rest } = doc;
  return { id: String(_id), ownerId: String(owner), ...rest };
}

function createMongoCapsuleRepository() {
  return {
    async create({ ownerId, name, eventDate, shareCode }) {
      const doc = await Capsule.create({ owner: ownerId, name, eventDate, shareCode });
      return toRecord(doc.toObject());
    },
    async listByOwner(ownerId) {
      if (!mongoose.isValidObjectId(ownerId)) return [];
      const docs = await Capsule.find({ owner: ownerId }).sort({ createdAt: -1 }).limit(100).lean();
      return docs.map(toRecord);
    },
    async countByOwner(ownerId) {
      if (!mongoose.isValidObjectId(ownerId)) return 0;
      return Capsule.countDocuments({ owner: ownerId });
    },
  };
}

module.exports = { createMongoCapsuleRepository };
