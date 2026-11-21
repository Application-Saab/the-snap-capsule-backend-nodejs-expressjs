// Sends a sample login-code email to check the SMTP settings in .env.
// Usage: npm run email:test -- you@example.com
require("dotenv").config();
const { createMailer, smtpHint } = require("../src/services/mailer");

async function main() {
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("Usage: npm run email:test -- you@example.com");
    process.exit(1);
  }

  // Only the email settings are needed here, not the whole server config.
  const config = {
    NODE_ENV: "development",
    SMTP_HOST: process.env.SMTP_HOST || "",
    SMTP_PORT: Number(process.env.SMTP_PORT || 465),
    SMTP_SECURE: String(process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false",
    SMTP_USER: process.env.SMTP_USER || "",
    SMTP_PASS: process.env.SMTP_PASS || "",
    MAIL_FROM: process.env.MAIL_FROM || "Snap Capsule <support@thesnapcapsule.com>",
  };
  if (!config.SMTP_HOST) {
    console.error("SMTP_HOST is empty in .env, so emails can't be sent. See README → Sending login-code emails.");
    process.exit(1);
  }

  const mailer = createMailer(config);
  console.log(`Connecting to ${config.SMTP_HOST}:${config.SMTP_PORT} (secure=${config.SMTP_SECURE}) as ${config.SMTP_USER || "(no user)"}…`);
  try {
    await mailer.verify();
    console.log("✓ SMTP login OK");
    await mailer.sendOtp(to, "1234", 10);
    console.log(`✓ Test email sent to ${to} from ${config.MAIL_FROM}. Check the inbox (and spam the first time).`);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    const hint = smtpHint(err);
    if (hint) console.error(`  → ${hint}`);
    process.exit(1);
  }
}

main();
