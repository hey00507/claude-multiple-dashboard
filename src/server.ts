import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eventsRoute } from './routes/events.js';
import { sessionsRoute } from './routes/sessions.js';
import { logsRoute } from './routes/logs.js';
import { streamRoute } from './routes/stream.js';
import { DEFAULT_PORT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(port = DEFAULT_PORT) {
  const app = Fastify({ logger: true });

  // In dev: src/ → ../public/  In dist: dist/src/ → ../../public/
  const publicDev = path.join(__dirname, '..', 'public');
  const publicDist = path.join(__dirname, '..', '..', 'public');
  const publicRoot = fs.existsSync(publicDev) ? publicDev : publicDist;

  await app.register(fastifyStatic, {
    root: publicRoot,
    prefix: '/',
  });

  await app.register(eventsRoute);
  await app.register(sessionsRoute);
  await app.register(logsRoute);
  await app.register(streamRoute);

  return app;
}

