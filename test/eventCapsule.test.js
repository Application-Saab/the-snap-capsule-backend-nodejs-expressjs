const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildTestApp, TEST_CONFIG } = require("./helpers");
const { signSessionToken } = require("../src/utils/sessionToken");

// Checks that don't need MongoDB. Saving the folder needs a real database.
const URL = "/api/internal/create-event-capsule";

async function signedIn() {
  const { app, users } = buildTestApp();
  const user = await users.create({ email: "rahul@example.com", emailVerified: true });
  const token = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "1h" });
  return { app, auth: { Authorization: `Bearer ${token}` } };
}

describe("POST /api/internal/create-event-capsule", () => {
  test("requires a signed-in user", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post(URL).send({ eventName: "Rahul's Wedding", eventDate: "2026-12-05" });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHENTICATED");
  });

  test("rejects a missing or too-short event name", async () => {
    const { app, auth } = await signedIn();
    for (const eventName of [undefined, "", " ", "A", "x".repeat(81)]) {
      const res = await request(app).post(URL).set(auth).send({ eventName, eventDate: "2026-12-05" });
      assert.equal(res.status, 400, String(eventName));
      assert.equal(res.body.error, true);
      assert.equal(res.body.data, null);
    }
  });

  test("rejects a customerId that isn't the signed-in user", async () => {
    const { app, auth } = await signedIn();
    const res = await request(app).post(URL).set(auth).send({ eventName: "Rahul's Wedding", eventDate: "2026-12-05", customerId: "someone-else" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, true);
  });

  test("getting a capsule requires a signed-in user", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/internal/event-capsule/abc");
    assert.equal(res.status, 401);
  });

  test("rejects a missing or invalid event date", async () => {
    const { app, auth } = await signedIn();
    for (const eventDate of [undefined, "", "05-12-2026", "2026-13-40", "2026-02-31", "tomorrow"]) {
      const res = await request(app).post(URL).set(auth).send({ eventName: "Rahul's Wedding", eventDate });
      assert.equal(res.status, 400, String(eventDate));
      assert.match(res.body.message, /event date/);
    }
  });
});
