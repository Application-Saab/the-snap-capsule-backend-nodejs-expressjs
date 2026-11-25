require("dotenv").config();
const mongoose = require("mongoose");
const { loadEnv } = require("./src/config/env");
const { createApp } = require("./src/app");
const { createMongoUserRepository } = require("./src/repositories/userRepository");
const { createMongoOtpRepository } = require("./src/repositories/otpRepository");
const { createMongoVisitorRepository } = require("./src/repositories/visitorRepository");
const { createGoogleVerifier } = require("./src/services/googleVerifier");
const { createMailer } = require("./src/services/mailer");

async function startServer() {
  try {
    const config = loadEnv();

    await mongoose.connect(config.MONGODB_URI);
    console.log("MongoDB Atlas connected successfully");
    if (config.HORA_JWT_SECRET && config.HORA_JWT_SECRET.length < 32) {
      // Hora's admin tokens are only as safe as this secret: a short or
      // public one lets anyone make an admin token and read the dashboard data.
      console.warn("WARNING: HORA_JWT_SECRET is weak (under 32 characters). Anyone who knows it can read Snap Capsule dashboard data. Use a long random secret in Hora and here.");
    }

    const mailer = createMailer(config);
    if (mailer.transport === "console") {
      console.warn("SMTP is not configured: login codes will be printed here instead of emailed.");
    }

    const app = createApp({
      config,
      users: createMongoUserRepository(),
      otps: createMongoOtpRepository(),
      mailer,
      verifyGoogleToken: createGoogleVerifier(config.GOOGLE_CLIENT_ID),
      visitors: createMongoVisitorRepository({ config }),
    });

    app.listen(config.PORT, () => {
      console.log(`Backend running at http://localhost:${config.PORT}`);
    });
  } catch (error) {
    console.error("Failed to start backend:", error.message);
    process.exit(1);
  }
}

startServer();
