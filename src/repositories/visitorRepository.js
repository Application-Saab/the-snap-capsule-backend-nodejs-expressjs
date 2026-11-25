const Visitor = require("../models/Visitor");
const FolderModel = require("../models/folder");
const { toCapsule } = require("../utils/capsule");

// Visitor storage, plus the one read query behind the admin panel's
// Snap Capsule page. Tests swap in an in-memory version.

// Snap Capsule folders never have an orderId (Hora's always do), so this
// keeps Hora folders out if both apps share a database.
const SNAP_CAPSULE_FOLDERS = { orderId: { $exists: false } };

function createMongoVisitorRepository({ config }) {
  return {
    /** Creates or updates a visitor; links the user when there is one. */
    async saveVisitor({ visitorId, user, now }) {
      const update = {
        $setOnInsert: { visitorId, firstSeenAt: now },
        $set: { lastSeenAt: now, ...(user ? { userId: user.id, ...(user.email ? { email: user.email } : {}) } : {}) },
      };
      try {
        await Visitor.updateOne({ visitorId }, update, { upsert: true });
      } catch (error) {
        // Two first requests at the same moment: the other one created it.
        if (error && error.code === 11000) await Visitor.updateOne({ visitorId }, update);
        else throw error;
      }
    },

    /**
     * Users for the admin panel, most recently active first:
     * { visitorId, email, capsules: [...] }. Capsules are the ones created
     * from this browser, plus (if logged in) all of that account's capsules.
     */
    async listUsers({ page, limit }) {
      const [total, rows] = await Promise.all([
        Visitor.countDocuments({}),
        Visitor.find({}).sort({ lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ]);
      const visitorIds = rows.map((v) => v.visitorId);
      const userIds = [...new Set(rows.map((v) => v.userId).filter(Boolean))];
      const folders = rows.length
        ? await FolderModel.find({
            ...SNAP_CAPSULE_FOLDERS,
            $or: [{ visitorId: { $in: visitorIds } }, ...(userIds.length ? [{ customerId: { $in: userIds } }] : [])],
          })
            .sort({ createdAt: -1 })
            .lean()
        : [];
      const items = rows.map((visitor) => ({
        visitorId: visitor.visitorId,
        email: visitor.email || null,
        capsules: folders
          .filter((f) => f.visitorId === visitor.visitorId || (visitor.userId && f.customerId === visitor.userId))
          .map((f) => ({ ...toCapsule(config, f), createdAt: f.createdAt })),
      }));
      return { items, total, page, limit };
    },
  };
}

module.exports = { createMongoVisitorRepository };
