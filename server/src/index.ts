import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { env, warnAboutDefaults } from './env';
import { errorMiddleware } from './http';
import { api } from './routes';
import { ensureRoundTo } from './roundTo';
import { initRepo } from './store';

async function main(): Promise<void> {
  warnAboutDefaults();
  await initRepo();
  // The one-time copy of stock's rounding step. Never holds the start up: a failure retries later.
  void ensureRoundTo().catch((err) => console.warn('[settings] rounding not copied yet:', err));

  const app = express();
  // Caddy, on this same box, is the only thing in front of the server. Trusting its
  // X-Forwarded-For makes req.ip the real device, so the PIN brake (rateLimit.ts) counts each
  // address on its own instead of lumping every device in the world under 127.0.0.1. Only a
  // loopback hop is trusted, so a header sent from outside cannot pick its own address.
  app.set('trust proxy', 'loopback');
  // 256 KB for everything but a restore, which reads its own (much larger) body: see routes.ts.
  const smallJson = express.json({ limit: '256kb' });
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.replace(/\/+$/, '') === '/api/restore') {
      next();
      return;
    }
    smallJson(req, res, next);
  });
  app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : true }));
  app.use('/api', api);

  // In production the built React app is served from the same origin, which means no CORS to
  // configure on the shop's machine and one URL to remember.
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Client build not found. Run npm run build first.');
    });
  });

  app.use(errorMiddleware);

  app.listen(env.port, () => {
    console.log('[server] listening on http://localhost:' + env.port);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
