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

Optional: `PORT` (5000), `JWT_EXPIRES_IN` (`7d`), `OTP_TTL_MINUTES` (10), `CORS_ORIGINS` (your website's addresses; also used for cross-site protection, see "Sign-in: cookie or Bearer"), `TRUST_PROXY`, `WEB_APP_URL` (`https://thesnapcapsule.com`, used to build capsule weblinks). See `.env.example`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server and database status |
| POST | `/api/auth/google` | Body `{ "credential": "<Google ID token>" }`. Verifies the token with Google, finds or creates the user, sets the session cookie, returns `{ user }` (+ `token`, see below) |
| POST | `/api/auth/email/request-otp` | Body `{ "email" }`. Emails a 4-digit code (valid 10 minutes). Response includes `codeLength: 4` |
| POST | `/api/auth/email/verify-otp` | Body `{ "email", "code" }`. Checks the code, finds or creates the user, sets the session cookie, returns `{ user }` (+ `token`, see below) |
| GET | `/api/auth/me` | Signed in (cookie or Bearer). Returns the signed-in user |
| POST | `/api/auth/logout` | Clears the session cookie |
| POST | `/api/internal/create-event-capsule` | Signed in. Creates an Event Capsule folder and returns its weblink (see below) |
| GET | `/api/internal/event-capsule/:galleryId` | Signed in. Returns the signed-in user's capsule (same `data` as create, plus `subFolders`); `404` if it isn't theirs |
| POST | `/api/track/visit` | Saves the visitor (see Visitor tracking) |
| GET | `/api/admin/users` | Admin panel token. Visitors with email and capsules |

### Sign-in: cookie or Bearer

Like Hora, the website calls this API directly on its own domain (`https://thesnapcapsule.com/api/*` → this backend, via the web server). Unlike Hora, the login isn't kept in `localStorage`:

- **Browser (website):** login sets an **httpOnly** cookie `sc_session` (`SameSite=Lax`, `Secure` in production, expires with the token, 7 days). Page JavaScript can't read it, and the browser sends it with every `/api` request. When a request has an `Origin` header (a browser), the token is **not** returned in the body.
- **Servers, apps, Postman:** requests without an `Origin` also get `token` in the body; send it as `Authorization: Bearer <token>`.
- **"Signed in"** means either the cookie or the Bearer header. The website's server-rendered pages forward the cookie when calling the API.
- **Cross-site protection:** a browser request that changes something (POST/PUT/PATCH/DELETE) must come from one of `CORS_ORIGINS` (checked via `Origin`, or `Referer`). Cookie-signed-in POSTs without either are refused. Otherwise: `403 FORBIDDEN_ORIGIN`. Bearer requests don't need an `Origin`.
- `POST /api/auth/logout` clears the cookie.

**`CORS_ORIGINS` must list the live site**, e.g. `https://thesnapcapsule.com,https://www.thesnapcapsule.com`, or the website's logins and Create Capsule are refused.

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

## Visitor tracking

Every browser that opens the website gets a **visitorId** (a random UUID) in the `sc_vid` cookie, kept for a year. When the visitor logs in, the visitorId is linked to their email, and capsules they create save the same visitorId. The admin panel reads it all with one API.

**How the visitorId reaches the backend**, checked in this order: body field `visitorId`, header `X-Visitor-Id`, or the `sc_vid` cookie. It must be 8–64 letters, digits, `-` or `_`. If a request has none, the backend creates one and sets the cookie.

| When | Saved |
|---|---|
| `POST /api/track/visit` `{ visitorId }` (website load) | `visitors`: visitorId, and email if logged in |
| Login (Google or email code) | `visitors`: userId + email |
| Create Event Capsule | `folders.visitorId` |

Tracking never blocks login: if it fails, the error is logged and login carries on.

### `GET /api/admin/users`

For the admin panel. Send the admin panel's login token (`localStorage.authToken`, from Hora's `/api/admin/admin_signin`) in the `Authorization` header, bare or as `Bearer <token>`. It's checked with `HORA_JWT_SECRET` and must have `role: "admin"`. Optional query:
- `page` (default 1) and `limit` (default 20, max 100)
- `search`: email, visitor ID, event name or short code
- `from` / `to`: dates like `2026-11-24`, for when the visitor was last on the website (a plain `to` date includes the whole day)

Newest activity comes first. `summary` has the totals for the cards on the admin page. It covers the whole site and isn't affected by filters.

```json
{
  "error": false, "status": 200, "message": "Users",
  "data": {
    "items": [
      {
        "visitorId": "11111111-2222-4333-8444-555555555555",
        "email": "rahul@example.com",
        "capsules": [
          {
            "folderId": "6b0683c8287f99fded29d622",
            "folderName": "Rahul's Wedding_6b0683c8287f99fded29d621_2026-12-05",
            "eventName": "Rahul's Wedding",
            "eventDate": "2026-12-05",
            "shortCode": "PshzzA8",
            "status": "processing",
            "webLink": "https://thesnapcapsule.com/weblink-gallery?galleryId=6b0683c8287f99fded29d622",
            "createdAt": "2026-11-25T06:44:24.707Z"
          }
        ]
      },
      { "visitorId": "anon-visitor-1234", "email": null, "capsules": [] }
    ],
    "total": 2, "page": 1, "limit": 20,
    "summary": { "visitors": 2, "newVisitors24h": 2, "loggedInVisitors": 1, "activeVisitors24h": 2, "capsules": 1, "capsules24h": 1 }
  }
}
```

`email` is `null` if the visitor never logged in. `capsules` holds the capsules created from that browser, plus all of the account's capsules once logged in. Folders with an `orderId` (Hora orders) are left out.

Settings (backend `.env`):

```
HORA_JWT_SECRET=<the secret Hora signs admin tokens with>
ADMIN_ORIGINS=https://<the admin panel's website>
```

`ADMIN_ORIGINS` lets the admin panel's website call the API from the browser (CORS). Without `HORA_JWT_SECRET` the API answers `404`.

> **Security:** the API is only as safe as `HORA_JWT_SECRET`. Hora currently signs tokens with a short secret written in its public code, so anyone could make an admin token. Move Hora's secret to a long random value in its `.env` and use the same value here. The server logs a warning at startup while the secret is under 32 characters.

## Project structure

```
server.js                     loads env, connects to MongoDB, starts the app
src/app.js                    Express app (middleware, routes, error handling)
src/config/env.js             environment validation
src/models/User.js            Mongoose user model
src/models/folder.js          Event Capsule folder model, copied from Hora (same collection; adds visitorId)
src/models/Visitor.js         one row per browser (visitorId), linked to the account at sign-in
src/routes/track.routes.js    /api/track/visit
src/routes/admin.routes.js    GET /api/admin/users (admin panel)
src/services/tracker.js       visitor tracking (never blocks login)
src/routes/weblink.js         /api/internal endpoints (create Event Capsule)
src/utils/capsuleGenerateShortCode.js  7-character capsule short codes (from Hora)
src/repositories/             database access (swap-able; tests use an in-memory store)
src/services/                 Google token verification, email codes, mailer, sign-in logic
src/routes/auth.routes.js     /api/auth endpoints
src/middleware/               requireAuth, requireAdmin, origin check, error handling
test/                         node:test + supertest
```
