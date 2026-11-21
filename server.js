require("dotenv").config();
const mongoose = require("mongoose");
const { loadEnv } = require("./src/config/env");
const { createApp } = require("./src/app");
const { createMongoUserRepository } = require("./src/repositories/userRepository");
const { createMongoOtpRepository } = require("./src/repositories/otpRepository");
const { createGoogleVerifier } = require("./src/services/googleVerifier");
const { createMailer, smtpHint } = require("./src/services/mailer");

async function startServer() {
  try {
    const config = loadEnv();

    await mongoose.connect(config.MONGODB_URI);
    console.log("MongoDB Atlas connected successfully");

    const mailer = createMailer(config);
    if (mailer.transport === "console") {
      console.warn("SMTP is not configured: login codes will be printed here instead of emailed.");
    } else {
      // Check the SMTP login in the background so problems show up at startup.
      mailer
        .verify()
        .then(() => console.log(`SMTP ready: login codes will be emailed from ${config.MAIL_FROM} via ${config.SMTP_HOST}`))
        .catch((err) => console.error(`SMTP check failed (${config.SMTP_HOST}:${config.SMTP_PORT}): ${err.message}`, smtpHint(err)));
    }

    const app = createApp({
      config,
      users: createMongoUserRepository(),
      otps: createMongoOtpRepository(),
      mailer,
      verifyGoogleToken: createGoogleVerifier(config.GOOGLE_CLIENT_ID),
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
