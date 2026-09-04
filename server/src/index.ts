import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { env, warnAboutDefaults } from './env';
import { errorMiddleware } from './http';
import { api } from './routes';
import { initRepo } from './store';

async function main(): Promise<void> {
  warnAboutDefaults();
  await initRepo();

  const app = express();
  app.use(express.json({ limit: '256kb' }));
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
