// Event Capsule routes, following the Hora backend (Hora-backend-api:
// createEventCapsuleFolder in routes/order.js, and routes/weblink.js mounted
// at /api/internal). In Hora the folder is created after an Event Capsule
// order; in Snap Capsule the signed-in user creates it from the
// "Let's Create Your Capsule" screen.
const express = require("express");
const FolderModel = require("../models/folder");
const capsuleGenerateShortCode = require("../utils/capsuleGenerateShortCode");
const capsuleUtils = require("../utils/capsule");
const { visitorIdFrom } = require("../utils/visitor");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

function createWeblinkRouter({ config }) {
  const router = express.Router();

  const toCapsule = (folder, eventName) => capsuleUtils.toCapsule(config, folder, eventName);
  const { eventNameOf } = capsuleUtils;

  // Create Event Capsule folder: { eventName, eventDate: "YYYY-MM-DD", customerId, visitorId? }
  // Requires sign-in; the customer is the signed-in user (req.user). If the
  // body has a customerId, it must be the signed-in user's id.
  router.post("/create-event-capsule", async (req, res, next) => {
    try {
      const eventName = typeof req.body?.eventName === "string" ? req.body.eventName.trim() : "";
      const eventDate = typeof req.body?.eventDate === "string" ? req.body.eventDate : "";

      if (eventName.length < 2 || eventName.length > 80) {
        return sendResponse(res, 400, true, "Please enter an event name (2–80 characters).");
      }
      const parsedDate = new Date(`${eventDate}T00:00:00Z`);
      // Also rejects impossible dates like 2026-02-31 (JS would turn it into 3 March).
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== eventDate
      ) {
        return sendResponse(res, 400, true, "Please choose a valid event date (YYYY-MM-DD).");
      }

      const customerId = String(req.user.id);
      if (req.body?.customerId !== undefined && String(req.body.customerId) !== customerId) {
        return sendResponse(res, 403, true, "customerId doesn't match the signed-in user");
      }
      // Hora: `${orderId}_${customerId}_${phoneNo}`. Snap Capsule:
      // `${eventName}_${customerId}_${eventDate}` (e.g. "Rahul's Wedding_<id>_2026-12-05").
      const folderName = `${eventName}_${customerId}_${eventDate}`;

      const existingFolder = await FolderModel.findOne({ folderName, customerId });
      if (existingFolder) {
        console.log(`Event Capsule folder already exists for ${customerId}: ${existingFolder._id}`);
        return sendResponse(res, 200, false, "Event capsule already exists", toCapsule(existingFolder, eventName));
      }

      const shortCode = await capsuleGenerateShortCode();
      // Browser that created it (body visitorId, X-Visitor-Id or sc_vid cookie), for the admin panel.
      const visitorId = visitorIdFrom(req) || undefined;

      const folder = new FolderModel({
        folderName,
        customerId,
        status: "processing",
        shortCode,
        eventDate: parsedDate,
        visitorId,
      });

      await folder.save();

      console.log(`Event Capsule folder created for ${customerId}: ${folder._id}`);

      return sendResponse(res, 201, false, "Event capsule created successfully", toCapsule(folder, eventName));
    } catch (error) {
      console.error("Failed to create Event Capsule folder:", error);
      next(error);
    }
  });

  // Get an Event Capsule by its galleryId (the folder _id in the webLink).
  // Only the capsule's owner can open it for now.
  router.get("/event-capsule/:galleryId", async (req, res, next) => {
    try {
      const folder = await FolderModel.findById(String(req.params.galleryId));
      if (!folder || folder.customerId !== String(req.user.id)) {
        return sendResponse(res, 404, true, "Event capsule not found");
      }
      return sendResponse(res, 200, false, "Event capsule found", {
        ...toCapsule(folder, eventNameOf(folder)),
        subFolders: folder.subFolders || [],
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createWeblinkRouter };
