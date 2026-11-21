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

Optional: `PORT` (5000), `JWT_EXPIRES_IN` (`7d`), `OTP_TTL_MINUTES` (10), `CORS_ORIGINS`, `TRUST_PROXY`, `WEB_APP_URL` (`https://thesnapcapsule.com`, used to build capsule weblinks). See `.env.example`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server and database status |
| POST | `/api/auth/google` | Body `{ "credential": "<Google ID token>" }`. Verifies the token with Google, finds or creates the user, returns `{ token, user }` |
| POST | `/api/auth/email/request-otp` | Body `{ "email" }`. Emails a 4-digit code (valid 10 minutes). Response includes `codeLength: 4` |
| POST | `/api/auth/email/verify-otp` | Body `{ "email", "code" }`. Checks the code, finds or creates the user, returns `{ token, user }` |
| GET | `/api/auth/me` | Header `Authorization: Bearer <token>`. Returns the signed-in user |
| POST | `/api/internal/create-event-capsule` | Header `Authorization: Bearer <token>`. Creates an Event Capsule folder and returns its weblink (see below) |
| GET | `/api/internal/event-capsule/:galleryId` | Header `Authorization: Bearer <token>`. Returns the signed-in user's capsule (same `data` as create, plus `subFolders`); `404` if it isn't theirs |

### Create Event Capsule (follows Hora)

Follows Hora's `createEventCapsuleFolder` (`Hora-backend-api`, `routes/order.js`) and uses the same `folders` collection and model. In Hora it runs after an Event Capsule order. Here, the signed-in user calls it from the "Let's Create Your Capsule" screen.

```
POST /api/internal/create-event-capsule
Authorization: Bearer <session token>
{ "eventName": "Rahul's Wedding", "eventDate": "2026-12-05", "customerId": "<signed-in user's id>" }
```

```json
201 {
  "error": false, "status": 201, "message": "Event capsule created successfully",
  "data": {
    "folderId": "6746a1f3c2…",
    "folderName": "Rahul's Wedding_<customerId>_2026-12-05",
    "eventName": "Rahul's Wedding",
    "eventDate": "2026-12-05",
    "shortCode": "L4eHLTo",
    "status": "processing",
    "webLink": "https://thesnapcapsule.com/weblink-gallery?galleryId=6746a1f3c2…"
  }
}
```

- `folderName` is `<eventName>_<customerId>_<eventDate>` (Hora uses `<orderId>_<customerId>_<phone>`).
- `customerId` is the signed-in user, from the token. If the body includes `customerId`, it must match (otherwise `403`).
- `status` starts as `"processing"`, and `shortCode` is a unique 7-character code (`utils/capsuleGenerateShortCode.js`, as Hora).
- `webLink` is `<WEB_APP_URL>/weblink-gallery?galleryId=<folder _id>`.
- Same user, same event name and same date again: `200 "Event capsule already exists"` with the existing folder (no duplicate). A different date creates a new capsule.
- `400` with `error: true` if the event name (2–80 characters) or date (`YYYY-MM-DD`) is invalid; `401` if not signed in.

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

1. `request-otp` creates a random 4-digit code, stores only an HMAC of it (never the code), and emails it.
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

### Sending login-code emails

Without `SMTP_HOST`, login codes are only printed in this terminal (`[dev] Login code for …`); nobody receives an email. To email them, fill in the SMTP settings in `.env` and restart:

| Provider | `SMTP_HOST` | `SMTP_PORT` / `SMTP_SECURE` | `SMTP_USER` | `SMTP_PASS` |
|---|---|---|---|---|
| Google Workspace | `smtp.gmail.com` | `465` / `true` | `support@thesnapcapsule.com` | 16-character **app password** (myaccount.google.com/apppasswords; needs 2-Step Verification on) |
| Resend | `smtp.resend.com` | `465` / `true` | `resend` | API key (`re_…`), after verifying the domain in Resend |
| Brevo | `smtp-relay.brevo.com` | `587` / `false` | Brevo login | SMTP key |

`MAIL_FROM` is the sender, e.g. `Snap Capsule <support@thesnapcapsule.com>`.

Check it:

```bash
npm run email:test -- you@example.com   # sends a sample login-code email and explains any error
npm start                               # prints "SMTP ready: …" or "SMTP check failed: … <hint>"
```

For good delivery, add the provider's SPF and DKIM records to the domain's DNS (GoDaddy). In production the server refuses to start without `SMTP_HOST`.

## Project structure

```
server.js                     loads env, connects to MongoDB, starts the app
src/app.js                    Express app (middleware, routes, error handling)
src/config/env.js             environment validation
src/models/User.js            Mongoose user model
src/models/folder.js          Event Capsule folder model, copied from Hora (same collection)
src/routes/weblink.js         /api/internal endpoints (create Event Capsule)
src/utils/capsuleGenerateShortCode.js  7-character capsule short codes (from Hora)
src/repositories/             database access (swap-able; tests use an in-memory store)
src/services/                 Google token verification, email codes, mailer, sign-in logic
src/routes/auth.routes.js     /api/auth endpoints
src/middleware/               requireAuth, error handling
test/                         node:test + supertest
scripts/send-test-email.js    npm run email:test: send a sample login-code email
```
