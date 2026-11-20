const { nanoid } = require("nanoid");
const Folder = require("../models/folder");

const capsuleGenerateShortCode = async () => {
  let shortCode;
  let exists = true;

  while (exists) {
    shortCode = nanoid(7);

      exists = await Folder.exists({
      shortCode,
    });
  }

  return shortCode;
};

module.exports = capsuleGenerateShortCode;
