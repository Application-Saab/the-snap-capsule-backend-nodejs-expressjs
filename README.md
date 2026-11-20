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
| POST | `/api/auth/email/request-otp` | Body `{ "email" }`. Emails a 4-digit code (valid 10 minutes). Response includes `codeLength: 4` |
| POST | `/api/auth/email/verify-otp` | Body `{ "email", "code" }`. Checks the code, finds or creates the user, returns `{ token, user }` |
| GET | `/api/auth/me` | Header `Authorization: Bearer <token>`. Returns the signed-in user |
| POST | `/api/customer/event/create-event-invite` | Header `Authorization: Bearer <token>`. Creates an event (see below) |

### Create event (same as Hora)

`POST /api/customer/event/create-event-invite` uses the same route code and the same MongoDB collections as the Hora backend (`Hora-backend-api`, `routes/createEventInvites.js`), on Snap Capsule's own database.

Body (all optional except `userId`):

```json
{ "userId": "<user _id>", "hostName": "Rahul's Wedding", "eventDate": "2026-12-05",
  "eventType": "", "eventTime": "", "location": "", "googleMapLink": "", "fromInternational": "", "orderId": "" }
```

Reply (Hora format): `201 { "error": false, "status": 201, "message": "Event created successfully", "data": <event> }`, `400 Invalid userId`, `404 User not found`.

What it does:
1. Generates a unique 7-character `shortCode` and the next `wonderland_id` (counter `wonderland_event_id` in `ticketcounters`).
2. Creates the event in `eventinvites`.
3. Adds the host to `eventguests` (`isHost: true`, `rsvpStatus: "will Come"`).
4. Creates a chat room in `chatrooms` and two welcome messages in `eventmessages`.
5. If any of 3–4 fails, removes what it created.
6. With an `orderId`, links the matching `folders` document and asks `https://horaservices.com/face-api/.../generate-banner` for a banner.

Differences from Hora:
- Requires a signed-in user (Bearer token).
- `senderPhone` on messages is optional, because Snap Capsule users sign in by email and may have no phone.
- `return next(innerErr)`, so a failed step doesn't also try to send "Event created successfully".

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

## Project structure

```
server.js                     loads env, connects to MongoDB, starts the app
src/app.js                    Express app (middleware, routes, error handling)
src/config/env.js             environment validation
src/models/User.js            Mongoose user model
src/models/event-*.js, eventChatRoom.js, eventMessage.js, ticket-counter-luckydraw.js, folder.js
                              event models, copied from Hora (same collections)
src/routes/createEventInvites.js  /api/customer/event endpoints (same as Hora)
src/utils/generateUniqueShortCode.js  7-character event short codes (from Hora)
src/repositories/             database access (swap-able; tests use an in-memory store)
src/services/                 Google token verification, email codes, mailer, sign-in logic
src/routes/auth.routes.js     /api/auth endpoints
src/middleware/               requireAuth, error handling
test/                         node:test + supertest
```
