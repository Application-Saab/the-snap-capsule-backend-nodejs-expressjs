const { nanoid } = require("nanoid");
const EventInvite = require("../models/event-invite");

const generateUniqueShortCode = async () => {
  let shortCode;
  let exists = true;

  while (exists) {
    shortCode = nanoid(7);

    exists = await EventInvite.exists({
      shortCode,
    });
  }

  return shortCode;
};

module.exports = generateUniqueShortCode;
