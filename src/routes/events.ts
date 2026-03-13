import type { FastifyInstance } from 'fastify';
import type { HookInput } from '../types.js';
import { handleEvent } from '../services/session-store.js';
import { appendLog } from '../services/log-store.js';

export async function eventsRoute(app: FastifyInstance) {
  app.post<{ Body: HookInput }>('/api/events', async (request, reply) => {
    const input = request.body;

    if (!input.session_id || !input.hook_event_name) {
      return reply.status(400).send({ error: 'Missing session_id or hook_event_name' });
    }

    // Skip Stop events that are already active (loop prevention)
    if (input.hook_event_name === 'Stop' && input.stop_hook_active) {
      return reply.status(200).send({ skipped: true });
    }

    const session = handleEvent(input);
    appendLog(input);

    return reply.status(200).send({ ok: true, sessionId: session.sessionId, status: session.status });
  });
}
