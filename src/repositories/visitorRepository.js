const Visitor = require("../models/Visitor");
const FolderModel = require("../models/folder");
const { toCapsule } = require("../utils/capsule");

// Visitor storage, plus the one read query behind the admin panel's
// Snap Capsule page. Tests swap in an in-memory version.

// Snap Capsule folders never have an orderId (Hora's always do), so this
// keeps Hora folders out if both apps share a database.
const SNAP_CAPSULE_FOLDERS = { orderId: { $exists: false } };
const DAY_MS = 24 * 60 * 60 * 1000;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Visitors matching `search` (email, visitor ID, or one of their capsules'
// event name / short code) and active between `from` and `to`.
async function visitorFilter({ search, from, to }) {
  const filter = {};
  if (from || to) {
    filter.lastSeenAt = {};
    if (from) filter.lastSeenAt.$gte = from;
    if (to) filter.lastSeenAt.$lte = to;
  }
  if (search) {
    const folders = await FolderModel.find(
      {
        ...SNAP_CAPSULE_FOLDERS,
        $or: [{ folderName: { $regex: escapeRegex(search), $options: "i" } }, { shortCode: search }],
      },
      { visitorId: 1, customerId: 1 }
    ).lean();
    filter.$or = [
      { visitorId: search },
      { email: { $regex: escapeRegex(search.toLowerCase()) } },
      ...(folders.length
        ? [
            { visitorId: { $in: folders.map((f) => f.visitorId).filter(Boolean) } },
            { userId: { $in: folders.map((f) => f.customerId).filter(Boolean) } },
          ]
        : []),
    ];
  }
  return filter;
}

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
    async listUsers({ page, limit, search = "", from, to }) {
      const filter = await visitorFilter({ search, from, to });
      const [total, rows] = await Promise.all([
        Visitor.countDocuments(filter),
        Visitor.find(filter).sort({ lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
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

    /** Totals for the admin page's summary cards. */
    async summary({ now }) {
      const since = new Date(now.getTime() - DAY_MS);
      const [visitors, newVisitors24h, loggedInVisitors, activeVisitors24h, capsules, capsules24h] = await Promise.all([
        Visitor.countDocuments({}),
        Visitor.countDocuments({ firstSeenAt: { $gte: since } }),
        Visitor.countDocuments({ email: { $exists: true } }),
        Visitor.countDocuments({ lastSeenAt: { $gte: since } }),
        FolderModel.countDocuments(SNAP_CAPSULE_FOLDERS),
        FolderModel.countDocuments({ ...SNAP_CAPSULE_FOLDERS, createdAt: { $gte: since } }),
      ]);
      return { visitors, newVisitors24h, loggedInVisitors, activeVisitors24h, capsules, capsules24h };
    },
  };
}

module.exports = { createMongoVisitorRepository };
