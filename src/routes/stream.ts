import type { FastifyInstance } from 'fastify';
import { eventBus } from '../services/event-bus.js';
import type { Session, LogEvent } from '../types.js';

export async function streamRoute(app: FastifyInstance) {
  app.get('/api/events/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const onSessionUpdate = (session: Session) => {
      reply.raw.write(`event: session_update\ndata: ${JSON.stringify(session)}\n\n`);
    };

    const onLogUpdate = (log: LogEvent) => {
      reply.raw.write(`event: log_update\ndata: ${JSON.stringify(log)}\n\n`);
    };

    eventBus.on('session_update', onSessionUpdate);
    eventBus.on('log_update', onLogUpdate);

    // Send heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30_000);

    request.raw.on('close', () => {
      eventBus.off('session_update', onSessionUpdate);
      eventBus.off('log_update', onLogUpdate);
      clearInterval(heartbeat);
    });
  });
}
