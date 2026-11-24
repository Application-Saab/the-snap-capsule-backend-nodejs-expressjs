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
| POST | `/api/track/visit` | Signed in or not. Records a page view for the visitor (see Visitor tracking) |
| GET | `/api/admin/stats` | Admin key. Totals and last 24 hours |
| GET | `/api/admin/capsules` | Admin key. Event Capsules with event name, date, email, visitorId and webLink |
| GET | `/api/admin/visitors` | Admin key. Visitors with their account and capsules |
| GET | `/api/admin/visitors/:visitorId` | Admin key. One visitor with account, capsules and activity |

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

Every browser that opens the website gets a **visitorId** (a random UUID), kept for a year in the `sc_vid` cookie. It works before sign-in, and is linked to the account at sign-in, so the dashboard can show who each visitor is and what they created.

**How the visitorId reaches the backend.** Any request can carry it in one of three ways, checked in this order:
1. body field `visitorId`
2. header `X-Visitor-Id`
3. the `sc_vid` cookie (sent automatically by the browser)

It must be 8–64 letters, digits, `-` or `_`; anything else is ignored. If a request has none, the backend creates one and sets the cookie.

**What gets recorded**

| When | Where | What |
|---|---|---|
| Every page view: `POST /api/track/visit` | `visitors`, `visitorevents` (`page_view`) | First visit: landing page, referrer, UTM tags. Every visit: last page, visit count, device type, locale. Signed in: account |
| Sign-in (Google or email code) | `visitors`, `visitorevents` (`login`) | userId, email, login method |
| Create Event Capsule | `folders.visitorId`, `visitorevents` (`capsule_created`) | Which browser created the capsule |

No IP addresses are stored. Tracking never blocks sign-in or capsule creation: if it fails, the error is logged and the request carries on.

`POST /api/track/visit` body (everything optional):

```json
{
  "visitorId": "3f1c2b9e-8d4a-4c3b-9a1e-5b6c7d8e9f00",
  "path": "/",
  "referrer": "https://www.google.com/",
  "locale": "en-IN",
  "utm": { "source": "instagram", "medium": "social", "campaign": "launch" }
}
```

Response: `{ "error": false, "status": 200, "message": "Visit recorded", "data": { "visitorId": "…", "isNew": true, "signedIn": false } }`. Only the path is kept (no query string, so gallery IDs in URLs aren't stored). Browser requests must come from `CORS_ORIGINS`, like sign-in.

**Admin dashboard API.** Read-only, turned on by setting `ADMIN_API_KEY` (at least 24 characters) and sent as the `X-Admin-Key` header. Call it from your dashboard's server or Postman, never from JavaScript in a visitor's browser, where anyone could read the key. Without `ADMIN_API_KEY` these routes answer `404`.

```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" "https://thesnapcapsule.com/api/admin/capsules?search=rahul@&page=1&limit=20"
```

Lists accept `page` (default 1), `limit` (default 20, max 100), `search`, and `from` / `to` dates (`2026-11-01`; a plain `to` date includes the whole day).

- `/api/admin/capsules`: one row per capsule, newest first: `eventName`, `eventDate`, `email`, `name`, `customerId`, `visitorId`, `webLink`, `shortCode`, `status`, `createdAt`. `search` matches event name, shortCode, visitorId or email.
- `/api/admin/visitors`: one row per visitor, most recently active first, with `user` (`email`, `name`) and the `capsules` created from that browser. `search` matches visitorId or email; `signedIn=true|false` filters.
- `/api/admin/visitors/:visitorId`: the same plus `events` (latest 100, newest first).
- `/api/admin/stats`: `visitors`, `signedInVisitors`, `activeVisitors24h`, `newVisitors24h`, `logins24h`, `capsules`, `capsules24h`.

Folders with an `orderId` (Hora orders) are left out, in case both apps share a database.

## Project structure

```
server.js                     loads env, connects to MongoDB, starts the app
src/app.js                    Express app (middleware, routes, error handling)
src/config/env.js             environment validation
src/models/User.js            Mongoose user model
src/models/folder.js          Event Capsule folder model, copied from Hora (same collection; adds visitorId)
src/models/Visitor.js         one row per browser (visitorId), linked to the account at sign-in
src/models/VisitorEvent.js    page views, sign-ins and capsules per visitor
src/routes/track.routes.js    /api/track/visit
src/routes/admin.routes.js    /api/admin dashboard endpoints (X-Admin-Key)
src/services/tracker.js       visitor tracking (never blocks sign-in or capsule creation)
src/routes/weblink.js         /api/internal endpoints (create Event Capsule)
src/utils/capsuleGenerateShortCode.js  7-character capsule short codes (from Hora)
src/repositories/             database access (swap-able; tests use an in-memory store)
src/services/                 Google token verification, email codes, mailer, sign-in logic
src/routes/auth.routes.js     /api/auth endpoints
src/middleware/               requireAuth, requireAdmin, origin check, error handling
test/                         node:test + supertest
```
