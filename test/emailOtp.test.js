const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { buildTestApp, TEST_CONFIG } = require("./helpers");
const { MAX_ATTEMPTS, MAX_SENDS_PER_HOUR } = require("../src/services/otpService");
const { otpEmail } = require("../src/services/mailer");

const requestOtp = (app, email) => request(app).post("/api/auth/email/request-otp").send({ email });
const verifyOtp = (app, email, code) => request(app).post("/api/auth/email/verify-otp").send({ email, code });
const wrong = (code) => String((Number(code) + 1) % 1000000).padStart(6, "0");

describe("POST /api/auth/email/request-otp", () => {
  test("emails a 6-digit code and stores only its hash", async () => {
    const { app, otps, mailer } = buildTestApp();
    const res = await requestOtp(app, "  Asha@Example.COM ");
    assert.equal(res.status, 200);
    assert.equal(res.body.email, "asha@example.com");
    assert.equal(res.body.expiresInMinutes, 10);
    assert.equal(res.body.resendAfterSeconds, 60);

    const code = mailer.lastCodeFor("asha@example.com");
    assert.match(code, /^\d{6}$/);
    const stored = otps.rows.get("asha@example.com");
    assert.ok(stored.codeHash);
    assert.notEqual(stored.codeHash, code);
    assert.equal(JSON.stringify(stored).includes(code), false, "plain code must not be stored");
  });

  test("rejects an invalid email", async () => {
    const { app, mailer } = buildTestApp();
    for (const email of ["", "not-an-email", "a@", undefined]) {
      const res = await request(app).post("/api/auth/email/request-otp").send({ email });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "INVALID_EMAIL");
    }
    assert.equal(mailer.sent.length, 0);
  });

  test("enforces a 60-second wait between codes", async () => {
    const { app, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    const res = await requestOtp(app, "asha@example.com");
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "OTP_COOLDOWN");
    assert.ok(res.body.retryAfter > 0 && res.body.retryAfter <= 60);
    assert.ok(res.headers["retry-after"]);
    assert.equal(mailer.sent.length, 1);
  });

  test("allows a new code after the wait, and the old code stops working", async () => {
    const { app, otps, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    const first = mailer.lastCodeFor("asha@example.com");
    otps.rows.get("asha@example.com").lastSentAt = new Date(Date.now() - 61 * 1000);

    const res = await requestOtp(app, "asha@example.com");
    assert.equal(res.status, 200);
    const second = mailer.lastCodeFor("asha@example.com");

    if (first !== second) {
      const old = await verifyOtp(app, "asha@example.com", first);
      assert.equal(old.status, 400);
    }
    const ok = await verifyOtp(app, "asha@example.com", second);
    assert.equal(ok.status, 200);
  });

  test(`limits each email to ${MAX_SENDS_PER_HOUR} codes per hour`, async () => {
    const { app, otps, mailer } = buildTestApp();
    for (let i = 0; i < MAX_SENDS_PER_HOUR; i++) {
      const res = await requestOtp(app, "asha@example.com");
      assert.equal(res.status, 200, `send ${i + 1}`);
      otps.rows.get("asha@example.com").lastSentAt = new Date(Date.now() - 61 * 1000);
    }
    const res = await requestOtp(app, "asha@example.com");
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "OTP_LIMIT");
    assert.equal(mailer.sent.length, MAX_SENDS_PER_HOUR);
  });

  test("returns a clear error when the email can't be sent", async () => {
    const { app, mailer } = buildTestApp();
    mailer.failNext = true;
    const res = await requestOtp(app, "asha@example.com");
    assert.equal(res.status, 502);
    assert.equal(res.body.code, "EMAIL_SEND_FAILED");
  });
});

describe("POST /api/auth/email/verify-otp", () => {
  test("correct code signs in a new user with a verified email", async () => {
    const { app, users, otps, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    const res = await verifyOtp(app, "Asha@Example.com", mailer.lastCodeFor("asha@example.com"));

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "asha@example.com");
    assert.equal(res.body.user.emailVerified, true);
    assert.equal(jwt.verify(res.body.token, TEST_CONFIG.JWT_SECRET).sub, res.body.user.id);
    assert.equal(users.rows.size, 1);
    assert.equal(otps.rows.size, 0, "code is deleted after use");

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "asha@example.com");
  });

  test("a code works only once", async () => {
    const { app, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    const code = mailer.lastCodeFor("asha@example.com");
    assert.equal((await verifyOtp(app, "asha@example.com", code)).status, 200);
    const again = await verifyOtp(app, "asha@example.com", code);
    assert.equal(again.status, 400);
    assert.equal(again.body.code, "OTP_EXPIRED");
  });

  test("wrong code reports attempts left, then locks the code", async () => {
    const { app, otps, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    const code = mailer.lastCodeFor("asha@example.com");

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const res = await verifyOtp(app, "asha@example.com", wrong(code));
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "OTP_INVALID");
      assert.equal(res.body.attemptsLeft, MAX_ATTEMPTS - i);
    }
    const last = await verifyOtp(app, "asha@example.com", wrong(code));
    assert.equal(last.body.code, "OTP_TOO_MANY_ATTEMPTS");
    assert.equal(otps.rows.size, 0);

    // Even the right code no longer works.
    const late = await verifyOtp(app, "asha@example.com", code);
    assert.equal(late.status, 400);
  });

  test("expired code is rejected", async () => {
    const { app, otps, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    otps.rows.get("asha@example.com").expiresAt = new Date(Date.now() - 1000);
    const res = await verifyOtp(app, "asha@example.com", mailer.lastCodeFor("asha@example.com"));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "OTP_EXPIRED");
  });

  test("code for one email can't be used for another", async () => {
    const { app, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    await requestOtp(app, "ravi@example.com");
    const res = await verifyOtp(app, "ravi@example.com", mailer.lastCodeFor("asha@example.com"));
    // Codes are random, so they could coincide; only assert when they differ.
    if (mailer.lastCodeFor("asha@example.com") !== mailer.lastCodeFor("ravi@example.com")) {
      assert.equal(res.status, 400);
    }
  });

  test("rejects malformed input", async () => {
    const { app } = buildTestApp();
    for (const body of [{ email: "asha@example.com" }, { email: "asha@example.com", code: "12ab56" }, { code: "123456" }]) {
      const res = await request(app).post("/api/auth/email/verify-otp").send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "INVALID_REQUEST");
    }
  });
});

describe("email and Google reach the same account", () => {
  test("Google first, then email code", async () => {
    const { app, users, mailer } = buildTestApp();
    const google = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    await requestOtp(app, "asha@example.com");
    const email = await verifyOtp(app, "asha@example.com", mailer.lastCodeFor("asha@example.com"));
    assert.equal(email.status, 200);
    assert.equal(email.body.user.id, google.body.user.id);
    assert.equal(users.rows.size, 1);
  });

  test("email code first, then Google links to the same user", async () => {
    const { app, users, mailer } = buildTestApp();
    await requestOtp(app, "asha@example.com");
    const email = await verifyOtp(app, "asha@example.com", mailer.lastCodeFor("asha@example.com"));
    const google = await request(app).post("/api/auth/google").send({ credential: "token-asha" });
    assert.equal(google.status, 200);
    assert.equal(google.body.user.id, email.body.user.id);
    assert.equal(google.body.user.name, "Asha Rao", "fills in the name from Google");
    assert.equal(users.rows.size, 1);
  });
});

describe("email template", () => {
  test("includes the code and expiry in subject, text and HTML", () => {
    const { subject, text, html } = otpEmail("042917", 10);
    assert.match(subject, /042917/);
    assert.match(text, /042917/);
    assert.match(text, /10 minutes/);
    assert.match(html, /042917/);
  });
});
