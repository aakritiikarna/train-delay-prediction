'use strict';
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  COOKIE_MAX_AGE_MS: z.coerce.number().int().positive().default(8 * 60 * 60 * 1000),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Comma-separated list of allowed browser origins. Empty = same-origin only.
  CORS_ORIGIN: z.string().default(''),
  // Needed when the app sits behind a reverse proxy (Render, Railway, Heroku...).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  ML_SERVICE_URL: z.string().url().default('http://localhost:5000'),
  ML_API_KEY: z.string().default(''),
  ML_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
});

function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  const env = parsed.data;
  env.isProd = env.NODE_ENV === 'production';
  env.rateLimitEnabled = env.RATE_LIMIT_ENABLED === 'true';
  env.corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  return env;
}

module.exports = { loadEnv };
