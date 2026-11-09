const crypto = require("crypto");
const { HttpError } = require("../utils/httpError");

// Safety cap until plans/limits are enforced.
const MAX_CAPSULES_PER_USER = 50;

const SHARE_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/l/I
const SHARE_CODE_LENGTH = 8;

function generateShareCode() {
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    code += SHARE_CODE_ALPHABET[crypto.randomInt(SHARE_CODE_ALPHABET.length)];
  }
  return code;
}

// "2026-12-05" → Date at midnight UTC (and back), so a date never moves a
// day earlier or later because of the server's or user's time zone.
function parseEventDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // e.g. 2026-02-30
  return date;
}

function formatEventDate(date) {
  return date.toISOString().slice(0, 10);
}

function toPublicCapsule(capsule) {
  return {
    id: capsule.id,
    name: capsule.name,
    eventDate: formatEventDate(new Date(capsule.eventDate)),
    shareCode: capsule.shareCode,
    createdAt: capsule.createdAt || null,
  };
}

async function createCapsule({ ownerId, name, eventDate, capsules }) {
  const count = await capsules.countByOwner(ownerId);
  if (count >= MAX_CAPSULES_PER_USER) {
    throw new HttpError(403, `You can have up to ${MAX_CAPSULES_PER_USER} capsules.`, "CAPSULE_LIMIT");
  }

  // Share codes are random; retry in the very unlikely case of a clash.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await capsules.create({ ownerId, name, eventDate, shareCode: generateShareCode() });
    } catch (err) {
      if (!(err && err.code === 11000)) throw err;
    }
  }
  throw new HttpError(500, "Couldn't create the capsule. Please try again.", "SHARE_CODE_CLASH");
}

module.exports = {
  createCapsule,
  toPublicCapsule,
  parseEventDate,
  formatEventDate,
  generateShareCode,
  MAX_CAPSULES_PER_USER,
  SHARE_CODE_LENGTH,
};
