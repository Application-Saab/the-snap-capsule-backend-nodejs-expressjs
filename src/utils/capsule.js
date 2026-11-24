// Shared by the Event Capsule routes and the admin dashboard, so a capsule
// looks the same everywhere.

const isoDate = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

/** <WEB_APP_URL>/weblink-gallery?galleryId=<folder _id> */
const webLinkOf = (config, folderId) =>
  `${config.WEB_APP_URL.replace(/\/+$/, "")}/weblink-gallery?galleryId=${encodeURIComponent(folderId)}`;

// folderName is `${eventName}_${customerId}_${eventDate}`; this gets the
// event name back by removing the customer and date part.
function eventNameOf(folder) {
  const suffix = `_${folder.customerId}_${isoDate(folder.eventDate) || ""}`;
  return folder.folderName.endsWith(suffix) ? folder.folderName.slice(0, -suffix.length) : folder.folderName;
}

/** The capsule as the API returns it. */
function toCapsule(config, folder, eventName = eventNameOf(folder)) {
  return {
    folderId: folder._id,
    folderName: folder.folderName,
    eventName,
    eventDate: isoDate(folder.eventDate),
    shortCode: folder.shortCode,
    status: folder.status,
    webLink: webLinkOf(config, folder._id),
  };
}

module.exports = { isoDate, webLinkOf, eventNameOf, toCapsule };
