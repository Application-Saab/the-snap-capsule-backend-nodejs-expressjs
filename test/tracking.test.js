const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { buildTestApp, TEST_CONFIG } = require("./helpers");
const { signSessionToken } = require("../src/utils/sessionToken");
const { loadEnv } = require("../src/config/env");

const SITE = TEST_CONFIG.corsOrigins[0];
const VISIT = "/api/track/visit";
const VID = "3f1c2b9e-8d4a-4c3b-9a1e-5b6c7d8e9f00";

const visitorCookie = (res) => (res.headers["set-cookie"] || []).find((c) => c.startsWith("sc_vid="));

describe("POST /api/track/visit", () => {
  test("a visitor without an ID gets a new one in the sc_vid cookie", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post(VISIT).set("Origin", SITE).send({});
    assert.equal(res.status, 200);
    const { visitorId, signedIn } = res.body.data;
    assert.match(visitorId, /^[0-9a-f-]{36}$/);
    assert.equal(signedIn, false);
    const cookie = visitorCookie(res);
    assert.ok(cookie.startsWith(`sc_vid=${visitorId};`));
    assert.match(cookie, /Max-Age=31536000/);
    assert.doesNotMatch(cookie, /HttpOnly/);
    assert.ok(visitors.rows.has(visitorId));
  });

  test("keeps the visitorId sent in the body, header or cookie", async () => {
    const { app, visitors } = buildTestApp();
    const body = await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID });
    assert.equal(body.body.data.visitorId, VID);
    const header = await request(app).post(VISIT).set("Origin", SITE).set("X-Visitor-Id", VID).send({});
    assert.equal(header.body.data.visitorId, VID);
    const cookie = await request(app).post(VISIT).set("Origin", SITE).set("Cookie", `sc_vid=${VID}`).send({});
    assert.equal(cookie.body.data.visitorId, VID);
    assert.equal(visitors.rows.size, 1);
  });

  test("an invalid visitorId is replaced with a new one", async () => {
    const { app } = buildTestApp();
    for (const visitorId of ["short", "<script>", "x".repeat(65), 12345]) {
      const res = await request(app).post(VISIT).set("Origin", SITE).send({ visitorId });
      assert.notEqual(res.body.data.visitorId, visitorId);
      assert.match(res.body.data.visitorId, /^[0-9a-f-]{36}$/);
    }
  });

  test("a logged-in visitor is saved with their email", async () => {
    const { app, users, visitors } = buildTestApp();
    const user = await users.create({ email: "asha@example.com", emailVerified: true });
    const token = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "1h" });
    const res = await request(app).post(VISIT).set("Origin", SITE).set("Cookie", `sc_session=${token}`).send({ visitorId: VID });
    assert.equal(res.body.data.signedIn, true);
    assert.equal(visitors.rows.get(VID).email, "asha@example.com");
    assert.equal(visitors.rows.get(VID).userId, user.id);
  });

  test("an invalid session still saves the visitor, without email", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post(VISIT).set("Origin", SITE).set("Cookie", "sc_session=nope").send({ visitorId: VID });
    assert.equal(res.status, 200);
    assert.equal(visitors.rows.get(VID).email, undefined);
  });

  test("browser requests from other websites are refused", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post(VISIT).set("Origin", "https://evil.example").send({ visitorId: VID });
    assert.equal(res.status, 403);
    assert.equal(visitors.rows.size, 0);
  });
});

describe("login links the visitor to the email", () => {
  test("email login with visitorId in the body", async () => {
    const { app, mailer, visitors } = buildTestApp();
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID });
    await request(app).post("/api/auth/email/request-otp").set("Origin", SITE).send({ email: "asha@example.com" }).expect(200);
    const res = await request(app)
      .post("/api/auth/email/verify-otp")
      .set("Origin", SITE)
      .send({ email: "asha@example.com", code: mailer.lastCodeFor("asha@example.com"), visitorId: VID });
    assert.equal(res.status, 200);
    assert.equal(visitors.rows.get(VID).email, "asha@example.com");
  });

  test("Google login with the sc_vid cookie", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).set("Cookie", `sc_vid=${VID}`).send({ credential: "token-asha" });
    assert.equal(res.status, 200);
    assert.equal(visitors.rows.get(VID).email, "asha@example.com");
  });

  test("login without a visitorId creates one and sets the cookie", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-ravi" });
    const visitorId = visitorCookie(res).split(";")[0].split("=")[1];
    assert.equal(visitors.rows.get(visitorId).email, "ravi@example.com");
  });

  test("a tracking failure never blocks login", async () => {
    const { app, visitors } = buildTestApp();
    visitors.failNext = true;
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-asha", visitorId: VID });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "asha@example.com");
  });
});

describe("GET /api/admin/users", () => {
  const HORA_SECRET = "hora-admin-secret-that-is-long-enough-1234";
  const DASHBOARD = "https://admin.example.com";
  const withAdmin = () => buildTestApp({ config: { ...TEST_CONFIG, HORA_JWT_SECRET: HORA_SECRET, adminOrigins: [DASHBOARD] } });
  // Same shape as Hora's admin_signin token.
  const horaToken = (fields = {}, secret = HORA_SECRET, options = { expiresIn: "365d" }) =>
    jwt.sign({ _id: "65a000000000000000000001", name: "Admin", email: "admin@horaservices.com", phone: "", role: "admin", ...fields }, secret, options);

  test("returns visitorId, email (null if not logged in) and capsules", async () => {
    const { app } = withAdmin();
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID });
    await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-asha", visitorId: VID });
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: "anon-visitor-0001" });
    const res = await request(app).get("/api/admin/users").set("Authorization", horaToken());
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.data.total, 2);
    const byId = Object.fromEntries(res.body.data.items.map((u) => [u.visitorId, u]));
    assert.deepEqual(Object.keys(byId[VID]).sort(), ["capsules", "email", "visitorId"]);
    assert.equal(byId[VID].email, "asha@example.com");
    assert.equal(byId["anon-visitor-0001"].email, null);
    assert.deepEqual(byId["anon-visitor-0001"].capsules, []);
  });

  test("page and limit", async () => {
    const { app } = withAdmin();
    const res = await request(app).get("/api/admin/users?page=2&limit=500").set("Authorization", `Bearer ${horaToken()}`);
    assert.equal(res.body.data.page, 2);
    assert.equal(res.body.data.limit, 100);
  });

  test("is off (404) without HORA_JWT_SECRET", async () => {
    const { app } = buildTestApp();
    assert.equal((await request(app).get("/api/admin/users").set("Authorization", horaToken())).status, 404);
  });

  test("refuses missing, forged, expired, non-admin and website-session tokens", async () => {
    const { app, users } = withAdmin();
    assert.equal((await request(app).get("/api/admin/users")).status, 401);
    assert.equal((await request(app).get("/api/admin/users").set("Authorization", horaToken({}, "secret"))).status, 401);
    assert.equal((await request(app).get("/api/admin/users").set("Authorization", horaToken({}, HORA_SECRET, { expiresIn: -10 }))).status, 401);
    assert.equal((await request(app).get("/api/admin/users").set("Authorization", jwt.sign({ role: "admin" }, "", { algorithm: "none" }))).status, 401);
    for (const role of ["customer", "supplier", "subadmin", undefined]) {
      assert.equal((await request(app).get("/api/admin/users").set("Authorization", horaToken({ role }))).status, 403, String(role));
    }
    const user = await users.create({ email: "asha@example.com", emailVerified: true });
    const session = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "1h" });
    assert.equal((await request(app).get("/api/admin/users").set("Authorization", `Bearer ${session}`)).status, 401);
  });

  test("the admin panel's website gets CORS", async () => {
    const { app } = withAdmin();
    const res = await request(app).options("/api/admin/users").set("Origin", DASHBOARD).set("Access-Control-Request-Method", "GET").set("Access-Control-Request-Headers", "authorization");
    assert.equal(res.headers["access-control-allow-origin"], DASHBOARD);
  });
});

describe("config", () => {
  test("HORA_JWT_SECRET is optional; ADMIN_ORIGINS is a trimmed list", () => {
    const base = { MONGODB_URI: "mongodb://localhost/test", GOOGLE_CLIENT_ID: "x.apps.googleusercontent.com", JWT_SECRET: "a".repeat(40) };
    assert.equal(loadEnv(base).HORA_JWT_SECRET, undefined);
    const env = loadEnv({ ...base, HORA_JWT_SECRET: "abc", ADMIN_ORIGINS: "https://admin.example.com/ , https://b.example.com" });
    assert.equal(env.HORA_JWT_SECRET, "abc");
    assert.deepEqual(env.adminOrigins, ["https://admin.example.com", "https://b.example.com"]);
  });
});
