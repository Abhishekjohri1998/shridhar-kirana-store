import 'dotenv/config';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v == null || v.trim() === '' ? fallback : v.trim();
}

export const env = {
  mongoUri: str('MONGO_URI', ''),
  jwtSecret: str('JWT_SECRET', 'dev-only-insecure-secret'),
  authPin: str('AUTH_PIN', '1234'),
  port: Number(str('PORT', '4000')),
  /** Overrides where the JSON fallback store lives. Used by the tests. */
  dataDir: str('DATA_DIR', ''),
  corsOrigins: str('CORS_ORIGIN', 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  isProduction: str('NODE_ENV', 'development') === 'production',
};

/** Shout about the settings that are fine on a laptop and dangerous on the internet. */
export function warnAboutDefaults(): void {
  if (env.jwtSecret === 'dev-only-insecure-secret') {
    console.warn('[warn] JWT_SECRET is unset. Anyone could mint a login token. Set it before deploying.');
  }
  if (env.authPin === '1234') {
    console.warn('[warn] AUTH_PIN is still 1234. Change it before the shop goes live.');
  }
  if (!env.mongoUri) {
    console.warn('[warn] MONGO_URI is unset, so data is going to server/.data/db.json, not MongoDB.');
  }
}
