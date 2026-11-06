const mongoose = require("mongoose");
const User = require("../models/User");

// The auth logic talks to users only through these functions, so it can be
// tested with an in-memory store and the database can change later without
// touching routes or services.
//
// Every function returns a plain "user record" or null:
//   { id, name, email, emailVerified, avatarUrl, googleId, lastLoginAt, createdAt, updatedAt }

function toRecord(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest };
}

function createMongoUserRepository() {
  return {
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) return null;
      return toRecord(await User.findById(id).lean());
    },
    async findByGoogleId(googleId) {
      return toRecord(await User.findOne({ googleId }).lean());
    },
    async findByEmail(email) {
      return toRecord(await User.findOne({ email: email.toLowerCase() }).lean());
    },
    async create(data) {
      const doc = await User.create(data);
      return toRecord(doc.toObject());
    },
    async update(id, fields) {
      const doc = await User.findByIdAndUpdate(
        id,
        { $set: fields },
        { returnDocument: "after", runValidators: true }
      ).lean();
      return toRecord(doc);
    },
  };
}

module.exports = { createMongoUserRepository };
