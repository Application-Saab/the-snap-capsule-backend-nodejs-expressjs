const { createApp } = require("../src/app");

const TEST_CONFIG = {
  NODE_ENV: "test",
  JWT_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
  JWT_EXPIRES_IN: "7d",
  corsOrigins: ["http://localhost:3000"],
  TRUST_PROXY: 0,
  OTP_TTL_MINUTES: 10,
};

// In-memory stand-in for the MongoDB login-code repository.
function createMemoryOtpRepository() {
  const rows = new Map();
  return {
    rows,
    async get(email) {
      const r = rows.get(email);
      return r ? { ...r } : null;
    },
    async upsert(email, fields) {
      rows.set(email, { ...(rows.get(email) || {}), email, ...fields });
    },
    async consumeAttempt(email, maxAttempts, now) {
      const r = rows.get(email);
      if (!r || r.attempts >= maxAttempts || r.expiresAt <= now) return null;
      r.attempts += 1;
      return { ...r };
    },
    async remove(email) {
      rows.delete(email);
    },
  };
}

// Captures emails instead of sending them.
function createFakeMailer() {
  const sent = [];
  return {
    sent,
    failNext: false,
    lastCodeFor(email) {
      const hit = [...sent].reverse().find((m) => m.email === email);
      return hit && hit.code;
    },
    async sendOtp(email, code, ttlMinutes) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("SMTP down");
      }
      sent.push({ email, code, ttlMinutes });
    },
  };
}

// In-memory stand-in for the MongoDB user repository, including the unique
// indexes on email and googleId.
function createMemoryUserRepository() {
  const rows = new Map();
  let seq = 0;
  const clone = (r) => (r ? { ...r } : null);
  const duplicate = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
  const clash = (data, exceptId) =>
    [...rows.values()].some(
      (r) =>
        r.id !== exceptId &&
        ((data.email && r.email === data.email) || (data.googleId && r.googleId === data.googleId))
    );

  return {
    rows,
    async findById(id) {
      return clone(rows.get(id));
    },
    async findByGoogleId(googleId) {
      return clone([...rows.values()].find((r) => r.googleId === googleId));
    },
    async findByEmail(email) {
      return clone([...rows.values()].find((r) => r.email === email.toLowerCase()));
    },
    async create(data) {
      if (clash(data)) throw duplicate();
      const now = new Date();
      const id = `user_${++seq}`;
      const row = Object.fromEntries(Object.entries({ id, ...data, createdAt: now, updatedAt: now }).filter(([, v]) => v !== undefined));
      rows.set(id, row);
      return clone(row);
    },
    async update(id, fields) {
      const row = rows.get(id);
      if (!row) return null;
      if (clash(fields, id)) throw duplicate();
      Object.assign(row, fields, { updatedAt: new Date() });
      return clone(row);
    },
  };
}

// Fake Google: credentials are keys into this table; anything else is
// treated as an invalid token, like Google's verifier would.
const GOOGLE_PROFILES = {
  "token-asha": { googleId: "g-asha", email: "asha@example.com", emailVerified: true, name: "Asha Rao", avatarUrl: "https://example.com/asha.png" },
  "token-asha-new-google": { googleId: "g-asha-2", email: "asha@example.com", emailVerified: true, name: "Asha Rao" },
  "token-ravi": { googleId: "g-ravi", email: "ravi@example.com", emailVerified: true, name: "Ravi Kumar" },
  "token-unverified": { googleId: "g-unv", email: "taken@example.com", emailVerified: false, name: "Unverified" },
};

async function fakeVerifyGoogleToken(credential) {
  const profile = GOOGLE_PROFILES[credential];
  if (!profile) throw new Error("Invalid token");
  return { ...profile };
}

function buildTestApp(overrides = {}) {
  const users = overrides.users || createMemoryUserRepository();
  const otps = overrides.otps || createMemoryOtpRepository();
  const mailer = overrides.mailer || createFakeMailer();
  const app = createApp({
    config: TEST_CONFIG,
    users,
    otps,
    mailer,
    verifyGoogleToken: overrides.verifyGoogleToken || fakeVerifyGoogleToken,
  });
  return { app, users, otps, mailer };
}

module.exports = { buildTestApp, createMemoryUserRepository, createMemoryOtpRepository, createFakeMailer, TEST_CONFIG };
