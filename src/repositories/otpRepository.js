const OtpCode = require("../models/OtpCode");

// Database access for login codes. Returns plain objects or null.
function createMongoOtpRepository() {
  const strip = (doc) => {
    if (!doc) return null;
    const { _id, __v, ...rest } = doc;
    return rest;
  };

  return {
    async get(email) {
      return strip(await OtpCode.findOne({ email }).lean());
    },
    async upsert(email, fields) {
      await OtpCode.updateOne({ email }, { $set: { email, ...fields } }, { upsert: true, runValidators: true });
    },
    // Atomically counts one verification attempt. Returns the updated record,
    // or null if there is no usable code (missing, expired, or out of attempts).
    // Doing this in one step stops parallel guesses from exceeding the limit.
    async consumeAttempt(email, maxAttempts, now) {
      return strip(
        await OtpCode.findOneAndUpdate(
          { email, attempts: { $lt: maxAttempts }, expiresAt: { $gt: now } },
          { $inc: { attempts: 1 } },
          { returnDocument: "after" }
        ).lean()
      );
    },
    async remove(email) {
      await OtpCode.deleteOne({ email });
    },
  };
}

module.exports = { createMongoOtpRepository };
