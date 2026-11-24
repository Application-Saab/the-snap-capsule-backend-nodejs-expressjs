const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildTestApp, TEST_CONFIG } = require("./helpers");

// The website talks to this API from the browser on the same domain
// (thesnapcapsule.com/api/* → backend), signed in with an httpOnly cookie.
const SITE = TEST_CONFIG.corsOrigins[0]; // http://localhost:3000
const EVIL = "https://evil.example";

async function signInWithCode(app, mailer, email, origin) {
  let req = request(app).post("/api/auth/email/request-otp");
  if (origin) req = req.set("Origin", origin);
  await req.send({ email }).expect(200);
  let verify = request(app).post("/api/auth/email/verify-otp");
  if (origin) verify = verify.set("Origin", origin);
  return verify.send({ email, code: mailer.lastCodeFor(email) });
}

const sessionCookie = (res) => (res.headers["set-cookie"] || []).find((c) => c.startsWith("sc_session="));
const cookiePair = (res) => sessionCookie(res).split(";")[0];

describe("session cookie", () => {
  test("login from the browser sets an httpOnly cookie and doesn't return the token", async () => {
    const { app, mailer } = buildTestApp();
    const res = await signInWithCode(app, mailer, "asha@example.com", SITE);
    assert.equal(res.status, 200);
    const cookie = sessionCookie(res);
    assert.ok(cookie, "sets sc_session");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=60480\d/); // 7 days, like the token
    assert.doesNotMatch(cookie, /Secure/); // HTTPS-only is added in production
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.user.email, "asha@example.com");
  });

  test("login without an Origin (server, app, Postman) also returns the token", async () => {
    const { app, mailer } = buildTestApp();
    const res = await signInWithCode(app, mailer, "asha@example.com");
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.ok(sessionCookie(res));
  });

  test("Google login sets the cookie too", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/google").set("Origin", SITE).send({ credential: "token-asha" });
    assert.equal(res.status, 200);
    assert.ok(sessionCookie(res));
    assert.equal(res.body.token, undefined);
  });

  test("the cookie signs requests in: /api/auth/me", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com", SITE);
    const me = await request(app).get("/api/auth/me").set("Cookie", cookiePair(login));
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "asha@example.com");
  });

  test("a bad cookie is refused", async () => {
    const { app } = buildTestApp();
    const me = await request(app).get("/api/auth/me").set("Cookie", "sc_session=not-a-token");
    assert.equal(me.status, 401);
  });

  test("Bearer still works", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(me.status, 200);
  });

  test("logout clears the cookie", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/logout").set("Origin", SITE);
    assert.equal(res.status, 200);
    assert.match(sessionCookie(res), /^sc_session=;.*Max-Age=0/);
  });
});

describe("cross-site protection", () => {
  test("login requests from another website are refused", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/email/request-otp").set("Origin", EVIL).send({ email: "asha@example.com" });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "FORBIDDEN_ORIGIN");
  });

  test("cookie-signed-in POST from another website is refused", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com", SITE);
    const res = await request(app)
      .post("/api/internal/create-event-capsule")
      .set("Cookie", cookiePair(login))
      .set("Origin", EVIL)
      .send({ eventName: "Rahul's Wedding", eventDate: "2026-12-05" });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "FORBIDDEN_ORIGIN");
  });

  test("cookie-signed-in POST with no Origin or Referer is refused", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com", SITE);
    const res = await request(app)
      .post("/api/internal/create-event-capsule")
      .set("Cookie", cookiePair(login))
      .send({ eventName: "Rahul's Wedding", eventDate: "2026-12-05" });
    assert.equal(res.status, 403);
  });

  test("cookie-signed-in POST from our own site passes the check", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com", SITE);
    // An invalid name: reaching the route's own 400 means sign-in and the origin check passed.
    const res = await request(app)
      .post("/api/internal/create-event-capsule")
      .set("Cookie", cookiePair(login))
      .set("Origin", SITE)
      .send({ eventName: "A", eventDate: "2026-12-05" });
    assert.equal(res.status, 400);
  });

  test("Referer from our own site is accepted when Origin is missing", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com", SITE);
    const res = await request(app)
      .post("/api/internal/create-event-capsule")
      .set("Cookie", cookiePair(login))
      .set("Referer", `${SITE}/`)
      .send({ eventName: "A", eventDate: "2026-12-05" });
    assert.equal(res.status, 400);
  });

  test("Bearer-signed-in POST doesn't need an Origin (apps, servers)", async () => {
    const { app, mailer } = buildTestApp();
    const login = await signInWithCode(app, mailer, "asha@example.com");
    const res = await request(app)
      .post("/api/internal/create-event-capsule")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({ eventName: "A", eventDate: "2026-12-05" });
    assert.equal(res.status, 400);
  });
});
