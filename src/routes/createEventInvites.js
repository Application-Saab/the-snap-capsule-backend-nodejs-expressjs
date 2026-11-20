// Event routes, following the Hora backend (Hora-backend-api:
// routes/createEventInvites.js, mounted at /api/customer/event).
// For now only what the "Let's Create Your Capsule" screen needs: the event
// itself. Host guest, chat room and welcome messages come later.
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const EventInvite = require("../models/event-invite");
const TicketCounter = require("../models/ticket-counter-luckydraw");
const User = require("../models/User");
const generateUniqueShortCode = require("../utils/generateUniqueShortCode");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

// Create event
router.post("/create-event-invite", async (req, res, next) => {
  try {
    const {
      userId,
      eventType,
      hostName,
      eventDate,
      eventTime,
      location,
      googleMapLink,
      fromInternational,
      orderId,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendResponse(res, 400, true, "Invalid userId");
    }

    // Generate unique short code
    const shortCode = await generateUniqueShortCode();

    // Parallel Fetch
    const [user, counter] = await Promise.all([
      User.findById(userId),

      TicketCounter.findOneAndUpdate(
        { _id: "wonderland_event_id" },
        { $inc: { sequenceValue: 1 } },
        { new: true, upsert: true },
      ),
    ]);

    if (!user) {
      return sendResponse(res, 404, true, "User not found");
    }

    // Create event invite
    const event = await EventInvite.create({
      userId,
      eventType,

      hostName,

      eventDate: eventDate ? new Date(eventDate) : null,

      eventTime,

      location,

      googleMapLink,

      fromInternational,

      orderId,

      wonderland_id: counter.sequenceValue,

      shortCode,
    });

    return sendResponse(res, 201, false, "Event created successfully", event);
  } catch (err) {
    err.isPublic = true;
    next(err);
  }
});

module.exports = router;
