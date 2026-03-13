import type { FastifyInstance } from 'fastify';
import { getAllSessions, getSession, renameSession } from '../services/session-store.js';
import type { SessionStatus } from '../types.js';

export async function sessionsRoute(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/api/sessions', async (request) => {
    const sessions = getAllSessions();

    if (request.query.status) {
      const statuses = request.query.status.split(',') as SessionStatus[];
      return sessions.filter(s => statuses.includes(s.status));
    }

    return sessions;
  });

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (request, reply) => {
    const session = getSession(request.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return session;
  });

  app.patch<{ Params: { sessionId: string }; Body: { projectName: string } }>('/api/sessions/:sessionId', async (request, reply) => {
    const { projectName } = request.body;
    if (!projectName || typeof projectName !== 'string') {
      return reply.status(400).send({ error: 'projectName is required' });
    }
    const session = renameSession(request.params.sessionId, projectName.trim());
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return session;
  });
}
