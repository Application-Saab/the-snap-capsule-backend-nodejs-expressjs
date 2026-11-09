const express = require("express");
const { z } = require("zod");
const { createRequireAuth } = require("../middleware/requireAuth");
const { createCapsule, toPublicCapsule, parseEventDate } = require("../services/capsuleService");
const { HttpError } = require("../utils/httpError");

const EARLIEST_YEAR = 1900;
const MAX_YEARS_AHEAD = 5;

const createBody = z.object({
  name: z.string().trim().min(2).max(80),
  eventDate: z.string().trim(),
});

function createCapsulesRouter({ config, users, capsules }) {
  const router = express.Router();
  router.use(createRequireAuth({ config, users }));

  // POST /api/capsules  { name, eventDate: "YYYY-MM-DD" } → 201 { capsule }
  router.post("/", async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      const field = parsed.error.issues[0] && parsed.error.issues[0].path[0];
      const message =
        field === "name" ? "Please enter an event name (2–80 characters)." : "Please choose the event date.";
      throw new HttpError(400, message, "INVALID_CAPSULE", { field });
    }

    const eventDate = parseEventDate(parsed.data.eventDate);
    const latest = new Date();
    latest.setUTCFullYear(latest.getUTCFullYear() + MAX_YEARS_AHEAD);
    if (!eventDate || eventDate.getUTCFullYear() < EARLIEST_YEAR || eventDate > latest) {
      throw new HttpError(400, "Please choose a valid event date.", "INVALID_CAPSULE", { field: "eventDate" });
    }

    const capsule = await createCapsule({
      ownerId: req.user.id,
      name: parsed.data.name,
      eventDate,
      capsules,
    });
    res.status(201).json({ success: true, capsule: toPublicCapsule(capsule) });
  });

  // GET /api/capsules → { capsules: [...] } (the signed-in user's, newest first)
  router.get("/", async (req, res) => {
    const list = await capsules.listByOwner(req.user.id);
    res.status(200).json({ success: true, capsules: list.map(toPublicCapsule) });
  });

  return router;
}

module.exports = { createCapsulesRouter };
