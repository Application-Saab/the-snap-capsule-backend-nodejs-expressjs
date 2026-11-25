const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildTestApp, TEST_CONFIG } = require("./helpers");
const { signSessionToken } = require("../src/utils/sessionToken");
const { loadEnv } = require("../src/config/env");
const { deviceTypeOf } = require("../src/utils/visitor");

const SITE = TEST_CONFIG.corsOrigins[0];
const VISIT = "/api/track/visit";
const VID = "3f1c2b9e-8d4a-4c3b-9a1e-5b6c7d8e9f00";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148";

const visitorCookie = (res) => (res.headers["set-cookie"] || []).find((c) => c.startsWith("sc_vid="));

describe("POST /api/track/visit", () => {
  test("a first visit without a visitorId gets a new one in the sc_vid cookie", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post(VISIT).set("Origin", SITE).set("User-Agent", MOBILE_UA).send({ path: "/" });
    assert.equal(res.status, 200);
    assert.equal(res.body.error, false);
    const { visitorId, isNew, signedIn } = res.body.data;
    assert.match(visitorId, /^[0-9a-f-]{36}$/);
    assert.equal(isNew, true);
    assert.equal(signedIn, false);
    const cookie = visitorCookie(res);
    assert.ok(cookie.startsWith(`sc_vid=${visitorId};`));
    assert.match(cookie, /Max-Age=31536000/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /HttpOnly/); // the website's JavaScript reads it
    const row = visitors.rows.get(visitorId);
    assert.equal(row.landingPage, "/");
    assert.equal(row.deviceType, "mobile");
    assert.equal(row.visitCount, 1);
    assert.deepEqual(visitors.events.map((e) => e.type), ["page_view"]);
  });

  test("the visitorId sent in the body is kept, and visits are counted", async () => {
    const { app, visitors } = buildTestApp();
    const first = await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID, path: "/" });
    const second = await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID, path: "/weblink-gallery" });
    assert.equal(first.body.data.visitorId, VID);
    assert.equal(first.body.data.isNew, true);
    assert.equal(second.body.data.isNew, false);
    assert.ok(visitorCookie(second).startsWith(`sc_vid=${VID};`), "cookie refreshed");
    const row = visitors.rows.get(VID);
    assert.equal(row.visitCount, 2);
    assert.equal(row.landingPage, "/");
    assert.equal(row.lastPage, "/weblink-gallery");
  });

  test("the visitorId can also come from the X-Visitor-Id header or the sc_vid cookie", async () => {
    const { app } = buildTestApp();
    const byHeader = await request(app).post(VISIT).set("Origin", SITE).set("X-Visitor-Id", VID).send({});
    assert.equal(byHeader.body.data.visitorId, VID);
    const byCookie = await request(app).post(VISIT).set("Origin", SITE).set("Cookie", `sc_vid=${VID}`).send({});
    assert.equal(byCookie.body.data.visitorId, VID);
    assert.equal(byCookie.body.data.isNew, false);
  });

  test("an invalid visitorId is replaced with a new one", async () => {
    const { app } = buildTestApp();
    for (const visitorId of ["short", "<script>alert(1)</script>", "x".repeat(65), 12345]) {
      const res = await request(app).post(VISIT).set("Origin", SITE).send({ visitorId });
      assert.equal(res.status, 200);
      assert.notEqual(res.body.data.visitorId, visitorId);
      assert.match(res.body.data.visitorId, /^[0-9a-f-]{36}$/);
    }
  });

  test("keeps the page path only, plus referrer, UTM tags and locale", async () => {
    const { app, visitors } = buildTestApp();
    await request(app)
      .post(VISIT)
      .set("Origin", SITE)
      .send({
        visitorId: VID,
        path: "/weblink-gallery?galleryId=secret#top",
        referrer: "https://www.google.com/",
        locale: "de",
        utm: { source: "instagram", medium: "social", campaign: "launch", junk: "ignored" },
      });
    const row = visitors.rows.get(VID);
    assert.equal(row.landingPage, "/weblink-gallery");
    assert.equal(row.referrer, "https://www.google.com/");
    assert.equal(row.locale, "de");
    assert.deepEqual(row.utm, { source: "instagram", medium: "social", campaign: "launch" });
  });

  test("a signed-in visit links the visitor to the account", async () => {
    const { app, users, visitors } = buildTestApp();
    const user = await users.create({ email: "asha@example.com", emailVerified: true });
    const token = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "1h" });
    const res = await request(app).post(VISIT).set("Origin", SITE).set("Cookie", `sc_session=${token}`).send({ visitorId: VID, path: "/" });
    assert.equal(res.body.data.signedIn, true);
    const row = visitors.rows.get(VID);
    assert.equal(row.userId, user.id);
    assert.equal(row.email, "asha@example.com");
  });

  test("an expired or fake session still records the visit, as signed out", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post(VISIT).set("Origin", SITE).set("Cookie", "sc_session=not-a-token").send({ visitorId: VID });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.signedIn, false);
    assert.equal(visitors.rows.get(VID).userId, undefined);
  });

  test("browser requests from other websites are refused", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post(VISIT).set("Origin", "https://evil.example").send({ visitorId: VID });
    assert.equal(res.status, 403);
    assert.equal(visitors.rows.size, 0);
  });
});

describe("login links the visitor", () => {
  test("email login with a visitorId links it to the account and logs a login event", async () => {
    const { app, mailer, visitors } = buildTestApp();
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID, path: "/" });
    await request(app).post("/api/auth/email/request-otp").set("Origin", SITE).send({ email: "asha@example.com" }).expect(200);
    const res = await request(app)
      .post("/api/auth/email/verify-otp")
      .set("Origin", SITE)
      .send({ email: "asha@example.com", code: mailer.lastCodeFor("asha@example.com"), visitorId: VID });
    assert.equal(res.status, 200);
    const row = visitors.rows.get(VID);
    assert.equal(row.email, "asha@example.com");
    assert.equal(row.userId, res.body.user.id);
    assert.equal(row.loginMethod, "email");
    const login = visitors.events.find((e) => e.type === "login");
    assert.equal(login.visitorId, VID);
    assert.equal(login.method, "email");
    assert.equal(login.email, "asha@example.com");
  });

  test("Google login reads the visitorId from the sc_vid cookie", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).set("Cookie", `sc_vid=${VID}`).send({ credential: "token-asha" });
    assert.equal(res.status, 200);
    assert.equal(visitors.rows.get(VID).loginMethod, "google");
    assert.equal(visitors.rows.get(VID).email, "asha@example.com");
  });

  test("login without a visitorId creates one and sets the cookie", async () => {
    const { app, visitors } = buildTestApp();
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-ravi" });
    assert.equal(res.status, 200);
    const cookie = visitorCookie(res);
    assert.ok(cookie);
    const visitorId = cookie.split(";")[0].split("=")[1];
    assert.equal(visitors.rows.get(visitorId).email, "ravi@example.com");
    assert.ok((res.headers["set-cookie"] || []).some((c) => c.startsWith("sc_session=")), "still signs in");
  });

  test("a tracking failure never blocks sign-in", async () => {
    const { app, visitors } = buildTestApp();
    visitors.failNext = true;
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-asha", visitorId: VID });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "asha@example.com");
  });
});

describe("admin dashboard", () => {
  const ADMIN = "team@thesnapcapsule.com";
  const DASHBOARD = "https://admin.example.com";
  const adminConfig = { ...TEST_CONFIG, adminEmails: [ADMIN], adminOrigins: [DASHBOARD] };
  const withAdmin = () => buildTestApp({ config: adminConfig });

  async function signIn(app, mailer, email = ADMIN) {
    await request(app).post("/api/admin/auth/request-otp").set("Origin", DASHBOARD).send({ email }).expect(200);
    const code = mailer.lastCodeFor(email);
    const res = await request(app).post("/api/admin/auth/verify-otp").set("Origin", DASHBOARD).send({ email, code });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.token;
  }

  test("is off (404) when ADMIN_EMAILS is empty", async () => {
    const { app } = buildTestApp();
    assert.equal((await request(app).get("/api/admin/stats")).status, 404);
    assert.equal((await request(app).post("/api/admin/auth/request-otp").send({ email: ADMIN })).status, 404);
  });

  test("team member signs in with email + code and reads the data", async () => {
    const { app, mailer } = withAdmin();
    const token = await signIn(app, mailer);
    const me = await request(app).get("/api/admin/auth/me").set("Authorization", `Bearer ${token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, ADMIN);
    const stats = await request(app).get("/api/admin/stats").set("Authorization", `Bearer ${token}`);
    assert.equal(stats.status, 200);
  });

  test("emails not in ADMIN_EMAILS can't get a code", async () => {
    const { app, mailer } = withAdmin();
    const res = await request(app).post("/api/admin/auth/request-otp").set("Origin", DASHBOARD).send({ email: "someone@example.com" });
    assert.equal(res.status, 403);
    assert.equal(mailer.lastCodeFor("someone@example.com"), undefined);
  });

  test("a website login code can't open the dashboard", async () => {
    const { app, mailer } = withAdmin();
    await request(app).post("/api/auth/email/request-otp").set("Origin", SITE).send({ email: ADMIN }).expect(200);
    const websiteCode = mailer.lastCodeFor(ADMIN);
    const res = await request(app).post("/api/admin/auth/verify-otp").set("Origin", DASHBOARD).send({ email: ADMIN, code: websiteCode });
    assert.equal(res.status, 400);
  });

  test("a customer's website session can't open the dashboard", async () => {
    const { app, users } = withAdmin();
    const user = await users.create({ email: ADMIN, emailVerified: true });
    const sessionToken = signSessionToken(user.id, { secret: TEST_CONFIG.JWT_SECRET, expiresIn: "1h" });
    const res = await request(app).get("/api/admin/visitors").set("Authorization", `Bearer ${sessionToken}`);
    assert.equal(res.status, 401);
  });

  test("no token, bad token, or a removed email are refused", async () => {
    const { app, mailer, users, otps, visitors } = withAdmin();
    assert.equal((await request(app).get("/api/admin/visitors")).status, 401);
    assert.equal((await request(app).get("/api/admin/visitors").set("Authorization", "Bearer nope")).status, 401);
    const token = await signIn(app, mailer);
    // Same token after the email is removed from ADMIN_EMAILS.
    const { app: later } = buildTestApp({ config: { ...adminConfig, adminEmails: ["other@thesnapcapsule.com"] }, users, otps, visitors, mailer });
    assert.equal((await request(later).get("/api/admin/visitors").set("Authorization", `Bearer ${token}`)).status, 403);
  });

  test("sign-in requests from other websites are refused; the dashboard gets CORS", async () => {
    const { app } = withAdmin();
    const evil = await request(app).post("/api/admin/auth/request-otp").set("Origin", "https://evil.example").send({ email: ADMIN });
    assert.equal(evil.status, 403);
    const preflight = await request(app).options("/api/admin/capsules").set("Origin", DASHBOARD).set("Access-Control-Request-Method", "GET").set("Access-Control-Request-Headers", "authorization");
    assert.equal(preflight.headers["access-control-allow-origin"], DASHBOARD);
  });

  test("lists visitors with their email, and is never cached", async () => {
    const { app, mailer } = withAdmin();
    const token = await signIn(app, mailer);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID, path: "/" });
    await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-asha", visitorId: VID });
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: "anon-visitor-0001", path: "/" });

    const all = await request(app).get("/api/admin/visitors").set(auth);
    assert.equal(all.status, 200);
    assert.equal(all.headers["cache-control"], "no-store");
    assert.equal(all.body.data.total, 2);
    const signedIn = await request(app).get("/api/admin/visitors?signedIn=true").set(auth);
    assert.equal(signedIn.body.data.items[0].email, "asha@example.com");
    const anonymous = await request(app).get("/api/admin/visitors?signedIn=false").set(auth);
    assert.equal(anonymous.body.data.items[0].visitorId, "anon-visitor-0001");
  });

  test("shows one visitor with their events", async () => {
    const { app, mailer } = withAdmin();
    const auth = { Authorization: `Bearer ${await signIn(app, mailer)}` };
    await request(app).post(VISIT).set("Origin", SITE).send({ visitorId: VID, path: "/" });
    await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-asha", visitorId: VID });
    const res = await request(app).get(`/api/admin/visitors/${VID}`).set(auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.events.map((e) => e.type), ["page_view", "login"]);
    assert.equal((await request(app).get("/api/admin/visitors/unknown-visitor-1").set(auth)).status, 404);
    assert.equal((await request(app).get("/api/admin/visitors/bad!").set(auth)).status, 400);
  });

  test("stats and capsules respond; bad dates are rejected", async () => {
    const { app, mailer } = withAdmin();
    const auth = { Authorization: `Bearer ${await signIn(app, mailer)}` };
    const capsules = await request(app).get("/api/admin/capsules?page=2&limit=500").set(auth);
    assert.equal(capsules.status, 200);
    assert.equal(capsules.body.data.page, 2);
    assert.equal(capsules.body.data.limit, 100);
    assert.equal((await request(app).get("/api/admin/capsules?from=yesterday").set(auth)).status, 400);
  });
});

describe("config and helpers", () => {
  const base = {
    MONGODB_URI: "mongodb://localhost/test",
    GOOGLE_CLIENT_ID: "x.apps.googleusercontent.com",
    JWT_SECRET: "a".repeat(40),
  };

  test("ADMIN_EMAILS and ADMIN_ORIGINS are trimmed lists", () => {
    const env = loadEnv({ ...base, ADMIN_EMAILS: " Team@TheSnapCapsule.com , ops@example.com ", ADMIN_ORIGINS: "https://admin.example.com/ ," });
    assert.deepEqual(env.adminEmails, ["team@thesnapcapsule.com", "ops@example.com"]);
    assert.deepEqual(env.adminOrigins, ["https://admin.example.com"]);
    assert.deepEqual(loadEnv(base).adminEmails, []);
    assert.equal(loadEnv(base).ADMIN_SESSION_HOURS, 12);
  });

  test("device type from the User-Agent", () => {
    assert.equal(deviceTypeOf(MOBILE_UA), "mobile");
    assert.equal(deviceTypeOf("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "tablet");
    assert.equal(deviceTypeOf("Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit"), "tablet");
    assert.equal(deviceTypeOf("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari"), "mobile");
    assert.equal(deviceTypeOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131"), "desktop");
    assert.equal(deviceTypeOf("Googlebot/2.1"), "bot");
    assert.equal(deviceTypeOf(""), "unknown");
  });
});
