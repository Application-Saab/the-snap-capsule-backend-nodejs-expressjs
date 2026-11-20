// Event routes, same architecture and collections as the Hora backend
// (Hora-backend-api: routes/createEventInvites.js, mounted at /api/customer/event).
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const axios = require("axios");
const EventInvite = require("../models/event-invite");
const EventGuest = require("../models/event-guest");
const TicketCounter = require("../models/ticket-counter-luckydraw");
const EventMessage = require("../models/eventMessage");
const ChatRoom = require("../models/eventChatRoom");
const Folders = require("../models/folder");
const User = require("../models/User");
const generateUniqueShortCode = require("../utils/generateUniqueShortCode");

const sendResponse = (res, status, error, message, data = null) =>
  res.status(status).json({ error, status, message, data });

// Combined route: Create event + register host as guest + create new room

router.post("/create-event-invite", async (req, res, next) => {
  let room = null;

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

        {
          new: true,
          upsert: true,
        },
      ),
    ]);

    if (!user) {
      return sendResponse(res, 404, true, "User not found");
    }

    const finalUserName = user.name || "WONDERLAND_USER";

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

    try {
      // Add host as guest
      await EventGuest.create({
        userId,

        eventId: event._id,

        name: finalUserName,

        rsvpStatus: "will Come",

        isHost: true,
      });

      // Create chat room
      room = await ChatRoom.create({
        eventId: event._id,

        roomName: hostName,

        createdBy: userId,

        members: [
          {
            userId,

            name: finalUserName,

            phone: user.phone,

            profileImageUrl: user.avatar,
          },
        ],
      });

      // Default messages
      await EventMessage.insertMany([
        {
          groupId: room._id,

          senderId: userId,

          message:
            "Welcome to Wonderland chat — where the fun begins even before the party!",

          type: "text",

          mediaUrl: "",

          senderName: finalUserName || "Wonderland",

          senderPhone: user.phone || "",
        },

        {
          groupId: room._id,

          senderId: userId,

          message: "What’s on your mind? !",

          type: "text",

          mediaUrl: "",

          senderName: finalUserName || "Wonderland",

          senderPhone: user.phone || "",
        },
      ]);
    } catch (innerErr) {
      await Promise.all([
        EventGuest.deleteMany({
          eventId: event._id,
        }),

        ChatRoom.deleteMany({
          eventId: event._id,
        }),

        EventInvite.findByIdAndDelete(event._id),

        room
          ? EventMessage.deleteMany({
              groupId: room._id,
            })
          : Promise.resolve(),
      ]);

      innerErr.isPublic = true;
      // return: stop here, so we don't also send "Event created successfully".
      return next(innerErr);
    }

    if (orderId) {
      try {
        const folder = await Folders.findOne({ orderId });

        if (!folder) {
          console.warn(`Folder not found for orderId: ${orderId}`);
        } else {
          folder.eventId = event._id;
          await folder.save();
          await axios.post(
            `https://horaservices.com/face-api/api/test/generate-banner/${folder._id}`,
            {},
          );
        }
      } catch (err) {
        console.error(
          `Generate banner failed for orderId ${orderId}:`,
          err.message,
        );
      }
    }

    return sendResponse(res, 201, false, "Event created successfully", event);
  } catch (err) {
    err.isPublic = true;
    next(err);
  }
});

module.exports = router;
