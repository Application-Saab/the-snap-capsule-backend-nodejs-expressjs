const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildTestApp, TEST_CONFIG } = require("./helpers");
const { signSessionToken } = require("../src/utils/sessionToken");

// Checks that don't need MongoDB. The full create flow (event, host guest,
// chat room, welcome messages, counter) needs a real database.
const URL = "/api/customer/event/create-event-invite";

async function signedIn() {
  const { app, users } = buildTestApp();
  const user = await users.create({ email: "host@example.com", emailVerified: true });
  const token = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "1h" });
  return { app, user, auth: { Authorization: `Bearer ${token}` } };
}

describe("POST /api/customer/event/create-event-invite", () => {
  test("requires a signed-in user", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post(URL).send({ userId: "507f1f77bcf86cd799439011", hostName: "Party" });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHENTICATED");
  });

  test("rejects an invalid userId with the Hora response shape", async () => {
    const { app, auth } = await signedIn();
    const res = await request(app).post(URL).set(auth).send({ userId: "not-an-id", hostName: "Party" });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: true, status: 400, message: "Invalid userId", data: null });
  });
});
