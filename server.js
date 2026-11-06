require("dotenv").config();
const mongoose = require("mongoose");
const { loadEnv } = require("./src/config/env");
const { createApp } = require("./src/app");
const { createMongoUserRepository } = require("./src/repositories/userRepository");
const { createGoogleVerifier } = require("./src/services/googleVerifier");

async function startServer() {
  try {
    const config = loadEnv();

    await mongoose.connect(config.MONGODB_URI);
    console.log("MongoDB Atlas connected successfully");

    const app = createApp({
      config,
      users: createMongoUserRepository(),
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
