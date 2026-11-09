const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildTestApp } = require("./helpers");
const {
  parseEventDate,
  generateShareCode,
  MAX_CAPSULES_PER_USER,
  SHARE_CODE_LENGTH,
} = require("../src/services/capsuleService");

async function signIn(app, credential = "token-asha") {
  const res = await request(app).post("/api/auth/google").send({ credential });
  return { token: res.body.token, user: res.body.user };
}
const create = (app, token, body) =>
  request(app).post("/api/capsules").set("Authorization", `Bearer ${token}`).send(body);
const list = (app, token) => request(app).get("/api/capsules").set("Authorization", `Bearer ${token}`);

describe("POST /api/capsules", () => {
  test("requires sign-in", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/capsules").send({ name: "Wedding", eventDate: "2026-12-05" });
    assert.equal(res.status, 401);
  });

  test("creates a capsule for the signed-in user", async () => {
    const { app, capsules } = buildTestApp();
    const { token, user } = await signIn(app);
    const res = await create(app, token, { name: "  Rahul & Priya Wedding ", eventDate: "2026-12-05" });

    assert.equal(res.status, 201);
    assert.equal(res.body.capsule.name, "Rahul & Priya Wedding");
    assert.equal(res.body.capsule.eventDate, "2026-12-05", "date comes back unchanged, no time-zone shift");
    assert.match(res.body.capsule.shareCode, new RegExp(`^[A-Za-z0-9]{${SHARE_CODE_LENGTH}}$`));
    assert.ok(res.body.capsule.id);
    assert.equal("ownerId" in res.body.capsule, false);

    const stored = capsules.rows.get(res.body.capsule.id);
    assert.equal(stored.ownerId, user.id);
    assert.equal(stored.eventDate.toISOString(), "2026-12-05T00:00:00.000Z");
  });

  test("allows past events", async () => {
    const { app } = buildTestApp();
    const { token } = await signIn(app);
    const res = await create(app, token, { name: "Graduation", eventDate: "2024-06-15" });
    assert.equal(res.status, 201);
  });

  test("validates the name", async () => {
    const { app } = buildTestApp();
    const { token } = await signIn(app);
    for (const name of [undefined, "", " a ", "x".repeat(81)]) {
      const res = await create(app, token, { name, eventDate: "2026-12-05" });
      assert.equal(res.status, 400, `name ${JSON.stringify(name)}`);
      assert.equal(res.body.field, "name");
    }
  });

  test("validates the date", async () => {
    const { app } = buildTestApp();
    const { token } = await signIn(app);
    const farFuture = `${new Date().getUTCFullYear() + 6}-01-01`;
    for (const eventDate of [undefined, "", "05-12-2026", "2026-02-30", "2026-13-01", "1850-01-01", farFuture]) {
      const res = await create(app, token, { name: "Birthday", eventDate });
      assert.equal(res.status, 400, `date ${JSON.stringify(eventDate)}`);
      assert.equal(res.body.field, "eventDate");
    }
  });

  test(`limits each user to ${MAX_CAPSULES_PER_USER} capsules`, async () => {
    const { app } = buildTestApp();
    const { token } = await signIn(app);
    for (let i = 0; i < MAX_CAPSULES_PER_USER; i++) {
      assert.equal((await create(app, token, { name: `Event ${i}`, eventDate: "2026-12-05" })).status, 201);
    }
    const res = await create(app, token, { name: "One more", eventDate: "2026-12-05" });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "CAPSULE_LIMIT");
  });
});

describe("GET /api/capsules", () => {
  test("lists only your own capsules, newest first", async () => {
    const { app } = buildTestApp();
    const asha = await signIn(app, "token-asha");
    const ravi = await signIn(app, "token-ravi");
    await create(app, asha.token, { name: "Asha first", eventDate: "2026-01-01" });
    await create(app, asha.token, { name: "Asha second", eventDate: "2026-02-01" });
    await create(app, ravi.token, { name: "Ravi party", eventDate: "2026-03-01" });

    const mine = await list(app, asha.token);
    assert.equal(mine.status, 200);
    assert.deepEqual(
      mine.body.capsules.map((c) => c.name),
      ["Asha second", "Asha first"]
    );
    const his = await list(app, ravi.token);
    assert.deepEqual(
      his.body.capsules.map((c) => c.name),
      ["Ravi party"]
    );
  });

  test("requires sign-in", async () => {
    const { app } = buildTestApp();
    assert.equal((await request(app).get("/api/capsules")).status, 401);
  });
});

describe("GET /api/capsules/:id", () => {
  test("returns your own capsule", async () => {
    const { app } = buildTestApp();
    const { token } = await signIn(app);
    const created = await create(app, token, { name: "Housewarming", eventDate: "2026-09-27" });
    const res = await request(app).get(`/api/capsules/${created.body.capsule.id}`).set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.capsule, created.body.capsule);
  });

  test("someone else's capsule looks the same as a missing one (404)", async () => {
    const { app } = buildTestApp();
    const asha = await signIn(app, "token-asha");
    const ravi = await signIn(app, "token-ravi");
    const created = await create(app, asha.token, { name: "Asha only", eventDate: "2026-09-27" });
    const theirs = await request(app)
      .get(`/api/capsules/${created.body.capsule.id}`)
      .set("Authorization", `Bearer ${ravi.token}`);
    const missing = await request(app).get("/api/capsules/does-not-exist").set("Authorization", `Bearer ${ravi.token}`);
    assert.equal(theirs.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(theirs.body, missing.body);
  });

  test("requires sign-in", async () => {
    const { app } = buildTestApp();
    assert.equal((await request(app).get("/api/capsules/capsule_1")).status, 401);
  });
});

describe("capsule helpers", () => {
  test("parseEventDate accepts real calendar dates only", () => {
    assert.equal(parseEventDate("2028-02-29").toISOString(), "2028-02-29T00:00:00.000Z");
    assert.equal(parseEventDate("2027-02-29"), null);
    assert.equal(parseEventDate("2026-1-5"), null);
  });

  test("share codes are random and avoid look-alike characters", () => {
    const codes = new Set(Array.from({ length: 500 }, generateShareCode));
    assert.equal(codes.size, 500);
    for (const code of codes) assert.doesNotMatch(code, /[0O1lI]/);
  });
});
