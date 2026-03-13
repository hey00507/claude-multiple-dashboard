import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import path from 'path';
import { fileURLToPath } from 'url';
import { eventsRoute } from './routes/events.js';
import { sessionsRoute } from './routes/sessions.js';
import { logsRoute } from './routes/logs.js';
import { streamRoute } from './routes/stream.js';
import { startProcessScanner } from './services/process-scanner.js';

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

async function main() {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const app = await createServer(port);

  startProcessScanner();

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Dashboard server running at http://localhost:${port}`);
}

main().catch(console.error);
