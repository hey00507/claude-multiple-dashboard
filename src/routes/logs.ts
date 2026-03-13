import type { FastifyInstance } from 'fastify';
import { getLogs, deleteLogs } from '../services/log-store.js';

export async function logsRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { date?: string; sessionId?: string; limit?: string; offset?: string };
  }>('/api/logs', async (request) => {
    const { date, sessionId, limit, offset } = request.query;
    return getLogs(date, sessionId, Number(limit) || 100, Number(offset) || 0);
  });

  app.delete<{ Querystring: { before: string } }>('/api/logs', async (request, reply) => {
    if (!request.query.before) {
      return reply.status(400).send({ error: 'Missing "before" query parameter' });
    }
    return deleteLogs(request.query.before);
  });
}
