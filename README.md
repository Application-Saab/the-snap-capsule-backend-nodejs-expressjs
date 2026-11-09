# The Snap Capsule — backend

Express 5 + MongoDB (Mongoose) API for thesnapcapsule.com.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:5000
npm test
```

Required environment variables (the server refuses to start without them):

| Variable | What it is |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `GOOGLE_CLIENT_ID` | Web client ID from Google Cloud → Google Auth Platform → Clients |
| `JWT_SECRET` | Random string, 32+ characters, used to sign session tokens |

Required in production: `SMTP_HOST` (plus `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_SECURE`, `MAIL_FROM`) for sending login codes. In development, leave `SMTP_HOST` empty and codes are printed in the terminal.

Optional: `PORT` (5000), `JWT_EXPIRES_IN` (`7d`), `OTP_TTL_MINUTES` (10), `CORS_ORIGINS`, `TRUST_PROXY`. See `.env.example`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server and database status |
| POST | `/api/auth/google` | Body `{ "credential": "<Google ID token>" }`. Verifies the token with Google, finds or creates the user, returns `{ token, user }` |
| POST | `/api/auth/email/request-otp` | Body `{ "email" }`. Emails a 6-digit code (valid 10 minutes) |
| POST | `/api/auth/email/verify-otp` | Body `{ "email", "code" }`. Checks the code, finds or creates the user, returns `{ token, user }` |
| GET | `/api/auth/me` | Header `Authorization: Bearer <token>`. Returns the signed-in user |
| POST | `/api/capsules` | Signed in. Body `{ "name", "eventDate": "YYYY-MM-DD" }`. Creates a capsule, returns `201 { capsule }` |
| GET | `/api/capsules` | Signed in. Returns `{ capsules }`, the user's own, newest first |

### How Google sign-in works

1. The website shows the Google Sign-In button. When the user approves, Google gives the browser a signed **ID token**.
2. The website's server sends it to `POST /api/auth/google`.
3. The backend verifies the token (signature, issuer, expiry, and that it was issued for our client ID), then:
   - signs in the user who has that Google account, or
   - links the Google account to an existing user with the same **verified** email, or
   - creates a new user.
4. It returns a session token (JWT). The website keeps it in an httpOnly cookie and sends it as a Bearer token on later requests.

Errors: `400` missing credential, `401` token rejected, `409` email already linked to a different Google account.

### How email sign-in works

1. `request-otp` creates a random 6-digit code, stores only an HMAC of it (never the code), and emails it.
2. `verify-otp` checks the code and returns a session token. Each code works once.
3. Limits: 5 wrong guesses per code, 60 seconds between codes, 5 codes per email per hour. Old codes are deleted automatically by MongoDB.

Email and Google lead to the **same account** when the email matches, so users can sign in either way.

| Error code | Meaning |
|---|---|
| `INVALID_EMAIL` | Email address isn't valid |
| `OTP_COOLDOWN` / `OTP_LIMIT` | Asked for codes too often (`429`, includes `retryAfter` seconds) |
| `EMAIL_SEND_FAILED` | SMTP failed (`502`) |
| `OTP_INVALID` | Wrong code (includes `attemptsLeft`) |
| `OTP_EXPIRED` / `OTP_TOO_MANY_ATTEMPTS` | Ask for a new code |

### Capsules

A capsule belongs to the user who created it. `eventDate` is a calendar date: send and receive it as `"YYYY-MM-DD"` (stored as midnight UTC, so it never shifts a day across time zones). Each capsule gets a random 8-character `shareCode` for the future guest link / QR code (no look-alike characters like 0/O or 1/l). Limits for now: name 2–80 characters, dates from 1900 up to 5 years ahead, 50 capsules per user.

## Project structure

```
server.js                     loads env, connects to MongoDB, starts the app
src/app.js                    Express app (middleware, routes, error handling)
src/config/env.js             environment validation
src/models/                   Mongoose models (User, OtpCode, Capsule)
src/repositories/             database access (swap-able; tests use an in-memory store)
src/services/                 Google token verification, email codes, mailer, sign-in logic
src/routes/                   /api/auth and /api/capsules endpoints
src/middleware/               requireAuth, error handling
test/                         node:test + supertest
```
