const mongoose = require("mongoose");
const Visitor = require("../models/Visitor");
const VisitorEvent = require("../models/VisitorEvent");
const User = require("../models/User");
const FolderModel = require("../models/folder");
const { toCapsule } = require("../utils/capsule");

// Visitor tracking storage (visitors + visitorevents collections), plus the
// read-only queries behind the admin dashboard. Routes and the tracker only
// use these functions, so tests can swap in an in-memory version.

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DAY_MS = 24 * 60 * 60 * 1000;

const plain = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return rest;
};

const publicUser = (user) =>
  user ? { id: String(user._id), name: user.name || null, email: user.email || null, lastLoginAt: user.lastLoginAt || null } : null;

// Snap Capsule folders never have an orderId (Hora's always do), so this
// keeps Hora folders out of the dashboard if both apps share a database.
const SNAP_CAPSULE_FOLDERS = { orderId: { $exists: false } };

function dateRange(field, from, to) {
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return Object.keys(range).length ? { [field]: range } : {};
}

async function usersById(ids) {
  const valid = [...new Set(ids.filter((id) => id && mongoose.isValidObjectId(id)))];
  if (!valid.length) return new Map();
  const users = await User.find({ _id: { $in: valid } }).lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

function createMongoVisitorRepository({ config }) {
  const capsuleRow = (folder, user) => ({
    ...toCapsule(config, folder),
    customerId: folder.customerId,
    email: user ? user.email || null : null,
    name: user ? user.name || null : null,
    visitorId: folder.visitorId || null,
    createdAt: folder.createdAt,
  });

  return {
    /**
     * Records one page view. Creates the visitor on its first visit; the
     * landing page, referrer and UTM tags are kept from that first visit.
     * Returns { visitor, isNew }.
     */
    async recordVisit({ visitorId, now, path, referrer, utm, userAgent, deviceType, locale, user }) {
      const update = {
        $setOnInsert: {
          visitorId,
          firstSeenAt: now,
          landingPage: path,
          referrer,
          ...(utm ? { utm } : {}),
        },
        $set: {
          lastSeenAt: now,
          lastPage: path,
          userAgent,
          deviceType,
          ...(locale ? { locale } : {}),
          ...(user ? { userId: user.id, ...(user.email ? { email: user.email } : {}) } : {}),
        },
        $inc: { visitCount: 1 },
        ...(user ? { $addToSet: { userIds: user.id } } : {}),
      };
      const run = () =>
        Visitor.findOneAndUpdate({ visitorId }, update, {
          upsert: true,
          returnDocument: "after",
          includeResultMetadata: true,
          setDefaultsOnInsert: true,
        }).lean();
      let result;
      try {
        result = await run();
      } catch (error) {
        // Two first visits at the same moment: the other one created it.
        if (error && error.code === 11000) result = await run();
        else throw error;
      }
      const isNew = Boolean(result.lastErrorObject && result.lastErrorObject.upserted);
      return { visitor: plain(result.value), isNew };
    },

    /** Links a visitor to the account that just signed in (creates the visitor if needed). */
    async linkUser({ visitorId, user, method, now, userAgent, deviceType }) {
      await Visitor.updateOne(
        { visitorId },
        {
          $setOnInsert: { visitorId, firstSeenAt: now, lastSeenAt: now, visitCount: 0, userAgent, deviceType },
          $set: { userId: user.id, ...(user.email ? { email: user.email } : {}), loginMethod: method, lastLoginAt: now },
          $addToSet: { userIds: user.id },
        },
        { upsert: true }
      ).catch((error) => {
        if (!error || error.code !== 11000) throw error;
      });
    },

    async addEvent(event) {
      await VisitorEvent.create(event);
    },

    // ── Dashboard (read-only) ─────────────────────────────────────────────

    async stats({ now }) {
      const since = new Date(now.getTime() - DAY_MS);
      const [visitors, signedInVisitors, activeVisitors24h, newVisitors24h, logins24h, capsules, capsules24h] =
        await Promise.all([
          Visitor.countDocuments({}),
          Visitor.countDocuments({ userId: { $exists: true } }),
          Visitor.countDocuments({ lastSeenAt: { $gte: since } }),
          Visitor.countDocuments({ firstSeenAt: { $gte: since } }),
          VisitorEvent.countDocuments({ type: "login", createdAt: { $gte: since } }),
          FolderModel.countDocuments(SNAP_CAPSULE_FOLDERS),
          FolderModel.countDocuments({ ...SNAP_CAPSULE_FOLDERS, createdAt: { $gte: since } }),
        ]);
      return { visitors, signedInVisitors, activeVisitors24h, newVisitors24h, logins24h, capsules, capsules24h };
    },

    /** Visitors, most recently active first, with their account and the capsules created from that browser. */
    async listVisitors({ page, limit, search, signedIn, from, to }) {
      const filter = { ...dateRange("lastSeenAt", from, to) };
      if (signedIn === true) filter.userId = { $exists: true };
      if (signedIn === false) filter.userId = { $exists: false };
      if (search) {
        filter.$or = [{ visitorId: search }, { email: { $regex: escapeRegex(search.toLowerCase()) } }];
      }
      const [total, rows] = await Promise.all([
        Visitor.countDocuments(filter),
        Visitor.find(filter).sort({ lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ]);
      const ids = rows.map((v) => v.visitorId);
      const [users, folders] = await Promise.all([
        usersById(rows.map((v) => v.userId)),
        ids.length ? FolderModel.find({ ...SNAP_CAPSULE_FOLDERS, visitorId: { $in: ids } }).sort({ createdAt: -1 }).lean() : [],
      ]);
      const items = rows.map((visitor) => {
        const user = users.get(visitor.userId);
        return {
          ...plain(visitor),
          user: publicUser(user),
          capsules: folders.filter((f) => f.visitorId === visitor.visitorId).map((f) => capsuleRow(f, user)),
        };
      });
      return { items, total, page, limit };
    },

    /** One visitor with their account, capsules and latest activity. */
    async getVisitor(visitorId, { eventLimit = 100 } = {}) {
      const visitor = await Visitor.findOne({ visitorId }).lean();
      if (!visitor) return null;
      const [users, folders, events] = await Promise.all([
        usersById([visitor.userId]),
        FolderModel.find({ ...SNAP_CAPSULE_FOLDERS, visitorId }).sort({ createdAt: -1 }).lean(),
        VisitorEvent.find({ visitorId }).sort({ createdAt: -1, _id: -1 }).limit(eventLimit).lean(),
      ]);
      const user = users.get(visitor.userId);
      return {
        ...plain(visitor),
        user: publicUser(user),
        capsules: folders.map((f) => capsuleRow(f, user)),
        events: events.map(plain),
      };
    },

    /**
     * Event Capsules, newest first: event name, event date, email, visitorId
     * and webLink. `search` matches the event/folder name, shortCode,
     * visitorId or the owner's email.
     */
    async listCapsules({ page, limit, search, from, to }) {
      const filter = { ...SNAP_CAPSULE_FOLDERS, ...dateRange("createdAt", from, to) };
      if (search) {
        const pattern = escapeRegex(search);
        const owners = await User.find({ email: { $regex: escapeRegex(search.toLowerCase()) } }, { _id: 1 }).lean();
        filter.$or = [
          { folderName: { $regex: pattern, $options: "i" } },
          { shortCode: search },
          { visitorId: search },
          ...(owners.length ? [{ customerId: { $in: owners.map((u) => String(u._id)) } }] : []),
        ];
      }
      const [total, folders] = await Promise.all([
        FolderModel.countDocuments(filter),
        FolderModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ]);
      const users = await usersById(folders.map((f) => f.customerId));
      return { items: folders.map((f) => capsuleRow(f, users.get(f.customerId))), total, page, limit };
    },
  };
}

module.exports = { createMongoVisitorRepository };
