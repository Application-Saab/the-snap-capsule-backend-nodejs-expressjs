const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { rateLimit } = require("express-rate-limit");
const { createAuthRouter } = require("./routes/auth.routes");
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
 */
function createApp({ config, users, otps, mailer, verifyGoogleToken }) {
  const app = express();

  if (config.TRUST_PROXY) app.set("trust proxy", config.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
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

  app.use("/api/auth", authLimiter, createAuthRouter({ config, users, otps, mailer, verifyGoogleToken }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
