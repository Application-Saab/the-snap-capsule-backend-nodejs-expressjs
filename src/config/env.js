const { z } = require("zod");

// All configuration comes from environment variables (.env locally, the
// hosting provider's settings in production). See .env.example.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string({ error: "MONGODB_URI is required" }).min(1, "MONGODB_URI is required"),

  // OAuth client ID from Google Cloud → Google Auth Platform → Clients.
  // Only the client ID is needed to verify Google sign-in tokens; the client
  // secret is not used by this flow.
  GOOGLE_CLIENT_ID: z
    .string({ error: "GOOGLE_CLIENT_ID is required" })
    .min(1, "GOOGLE_CLIENT_ID is required")
    .refine((v) => v.endsWith(".apps.googleusercontent.com"), {
      message: "GOOGLE_CLIENT_ID should end with .apps.googleusercontent.com",
    }),

  // Long random string used to sign session tokens. Generate one with:
  //   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_SECRET: z.string({ error: "JWT_SECRET is required" }).min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Comma-separated list of browser origins allowed to call this API.
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  // Number of reverse proxies in front of the app (e.g. 1 on Render/Railway/
  // Heroku-style hosts) so rate limiting sees the real client IP.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data;
  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

module.exports = { loadEnv };
