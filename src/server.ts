import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

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

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  await app.register(eventsRoute);
  await app.register(sessionsRoute);
  await app.register(logsRoute);
  await app.register(streamRoute);

  return app;
}

