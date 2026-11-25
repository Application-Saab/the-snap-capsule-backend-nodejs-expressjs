const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { rateLimit } = require("express-rate-limit");
const { createAuthRouter } = require("./routes/auth.routes");
const { createWeblinkRouter } = require("./routes/weblink");
const { createTrackRouter } = require("./routes/track.routes");
const { createAdminRouter } = require("./routes/admin.routes");
const { createRequireAdmin } = require("./middleware/requireAdmin");
const { createTracker } = require("./services/tracker");
const { createRequireAuth } = require("./middleware/requireAuth");
const { notFound, errorHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express app. Dependencies are passed in so tests can supply a
 * fake Google verifier and an in-memory user store.
 *
 * @param {object} deps
 * @param {object} deps.config            result of loadEnv()
 * @param {object} deps.users             user repository
 * @param {object} deps.otps              login-code repository
 * @param {object} deps.mailer            { sendOtp(email, code, ttlMinutes) }
 * @param {Function} deps.verifyGoogleToken (idToken) => Promise<profile>
 * @param {object} deps.visitors          visitor tracking repository
 */
function createApp({ config, users, otps, mailer, verifyGoogleToken, visitors }) {
  const app = express();
  const tracker = createTracker({ config, visitors });

  if (config.TRUST_PROXY) app.set("trust proxy", config.TRUST_PROXY);

  app.use(helmet());
  // The website, plus the admin dashboard's website (ADMIN_ORIGINS).
  app.use(cors({ origin: [...config.corsOrigins, ...config.adminOrigins] }));
  app.use(express.json({ limit: "100kb" }));
  if (config.NODE_ENV !== "test") app.use(morgan(config.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/api/health", (req, res) => {
    res.status(200).json({
      success: true,
      message: "TheSnapCapsule backend is running",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    });
  });

  // Sign-in requests go through the website's server, so many users can
  // share one IP. Keep the limit generous; it guards against floods, not
  // guessing (Google tokens can't be guessed).
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again in a minute." },
  });

  app.use("/api/auth", authLimiter, createAuthRouter({ config, users, otps, mailer, verifyGoogleToken, tracker }));

  // Visitor tracking: one call per page view, signed in or not.
  const trackLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: true, status: 429, message: "Too many requests. Please try again in a minute.", data: null },
  });
  app.use("/api/track", trackLimiter, createTrackRouter({ config, users, tracker }));

  // Admin dashboard (read-only): the admin panel's login token in the
  // Authorization header, checked with HORA_JWT_SECRET.
  app.use("/api/admin", createRequireAdmin({ config }), createAdminRouter({ visitors }));

  // Event Capsules (same folders collection as Hora). Requires a signed-in
  // user: Authorization: Bearer <session token>.
  app.use("/api/internal", createRequireAuth({ config, users }), createWeblinkRouter({ config, tracker }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
