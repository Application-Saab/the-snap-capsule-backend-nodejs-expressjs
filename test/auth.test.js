const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { buildTestApp, TEST_CONFIG } = require("./helpers");
const { signSessionToken } = require("../src/utils/sessionToken");
const { loadEnv } = require("../src/config/env");

describe("POST /api/auth/google", () => {
  test("rejects a request without a credential", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/google").send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "INVALID_REQUEST");
  });

  test("rejects malformed JSON", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/google").set("Content-Type", "application/json").send("{bad");
    assert.equal(res.status, 400);
  });

  test("rejects a token Google does not accept", async () => {
    const { app, users } = buildTestApp();
    const res = await request(app).post("/api/auth/google").send({ credential: "forged-token" });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "INVALID_GOOGLE_TOKEN");
    assert.equal(users.rows.size, 0);
  });

  test("creates a new user and returns a session token", async () => {
    const { app, users } = buildTestApp();
    const res = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(
      { name: res.body.user.name, email: res.body.user.email, emailVerified: res.body.user.emailVerified },
      { name: "Asha Rao", email: "asha@example.com", emailVerified: true }
    );
    assert.equal(users.rows.size, 1);

    const decoded = jwt.verify(res.body.token, TEST_CONFIG.JWT_SECRET);
    assert.equal(decoded.sub, res.body.user.id);
    assert.equal(decoded.iss, "thesnapcapsule-api");
    // Provider IDs stay private.
    assert.equal("googleId" in res.body.user, false);
  });

  test("signing in again returns the same user, no duplicate", async () => {
    const { app, users } = buildTestApp();
    const first = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    const second = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    assert.equal(second.status, 200);
    assert.equal(second.body.user.id, first.body.user.id);
    assert.equal(users.rows.size, 1);
  });

  test("links Google to an existing user with the same verified email", async () => {
    const { app, users } = buildTestApp();
    const existing = await users.create({ email: "ravi@example.com", emailVerified: true, name: "Ravi (OTP)" });
    const res = await request(app).post("/api/auth/google").send({ credential: "token-ravi" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, existing.id);
    assert.equal(res.body.user.name, "Ravi (OTP)", "keeps the name the user already had");
    assert.equal(users.rows.get(existing.id).googleId, "g-ravi");
    assert.equal(users.rows.size, 1);
  });

  test("does not link or store an unverified email", async () => {
    const { app, users } = buildTestApp();
    const owner = await users.create({ email: "taken@example.com", emailVerified: true, name: "Real owner" });
    const res = await request(app).post("/api/auth/google").send({ credential: "token-unverified" });
    assert.equal(res.status, 200);
    assert.notEqual(res.body.user.id, owner.id);
    assert.equal(res.body.user.email, null);
    assert.equal(users.rows.get(owner.id).googleId, undefined);
  });

  test("refuses to re-link an email already tied to another Google account", async () => {
    const { app } = buildTestApp();
    await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    const res = await request(app).post("/api/auth/google").send({ credential: "token-asha-new-google" });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "GOOGLE_ACCOUNT_CONFLICT");
  });

  test("recovers when two first sign-ins race", async () => {
    const { app, users } = buildTestApp();
    // Simulate the other request winning: the lookup misses, then create
    // hits the unique index because the user now exists.
    const realFind = users.findByGoogleId;
    let calls = 0;
    users.findByGoogleId = async (id) => (++calls === 1 ? null : realFind(id));
    await users.create({ googleId: "g-asha", email: "asha@example.com", emailVerified: true, name: "Asha Rao" });
    const realFindEmail = users.findByEmail;
    users.findByEmail = async () => null;

    const res = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    users.findByEmail = realFindEmail;
    assert.equal(res.status, 200);
    assert.equal(users.rows.size, 1);
  });
});

describe("GET /api/auth/me", () => {
  test("returns the signed-in user", async () => {
    const { app } = buildTestApp();
    const login = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, login.body.user.id);
    assert.equal(res.body.user.email, "asha@example.com");
  });

  test("401 without a token", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/auth/me");
    assert.equal(res.status, 401);
  });

  test("401 with a forged or expired token", async () => {
    const { app, users } = buildTestApp();
    const user = await users.create({ email: "x@example.com", emailVerified: true });
    const forged = signSessionToken(user.id, { secret: "a-different-secret-that-is-long-enough!!", expiresIn: "7d" });
    const expired = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: -10 });
    for (const token of ["garbage", forged, expired]) {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 401, `token ${token.slice(0, 12)}… should be rejected`);
    }
  });

  test("401 when the user no longer exists", async () => {
    const { app } = buildTestApp();
    const token = signSessionToken("user_missing", { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "7d" });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 401);
  });
});

describe("app basics", () => {
  test("health check responds", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test("unknown routes return 404 JSON", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});

describe("loadEnv", () => {
  const valid = {
    MONGODB_URI: "mongodb+srv://example",
    GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
    JWT_SECRET: "x".repeat(40),
    CORS_ORIGINS: "https://thesnapcapsule.com, http://localhost:3000",
  };

  test("accepts a valid configuration", () => {
    const env = loadEnv(valid);
    assert.equal(env.PORT, 5000);
    assert.deepEqual(env.corsOrigins, ["https://thesnapcapsule.com", "http://localhost:3000"]);
  });

  test("rejects a short JWT secret and a wrong client ID", () => {
    assert.throws(() => loadEnv({ ...valid, JWT_SECRET: "short" }), /JWT_SECRET/);
    assert.throws(() => loadEnv({ ...valid, GOOGLE_CLIENT_ID: "not-a-client-id" }), /GOOGLE_CLIENT_ID/);
  });
});
