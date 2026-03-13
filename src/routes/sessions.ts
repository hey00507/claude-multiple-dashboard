import type { FastifyInstance } from 'fastify';
import { execSync, exec } from 'child_process';
import { getAllSessions, getSession, renameSession, deleteSession, handleEvent } from '../services/session-store.js';
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

  app.delete<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (request, reply) => {
    const session = getSession(request.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    if (session.status === 'active') {
      return reply.status(400).send({ error: 'Cannot delete active session' });
    }
    deleteSession(request.params.sessionId);
    return { ok: true, sessionId: request.params.sessionId };
  });

  // Kill a session's claude process
  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/kill', async (request, reply) => {
    const session = getSession(request.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const activeStatuses: SessionStatus[] = ['active', 'waiting_input', 'waiting_permission'];
    if (!activeStatuses.includes(session.status)) {
      return reply.status(400).send({ error: 'Session is not active' });
    }

    // Find claude process by session_id in command args or transcript_path
    let pid: number | null = null;
    try {
      const psOutput = execSync("ps aux | grep '[c]laude'", { encoding: 'utf-8' });
      for (const line of psOutput.trim().split('\n')) {
        if (line.includes(session.sessionId) || line.includes(session.cwd)) {
          const parts = line.trim().split(/\s+/);
          pid = Number(parts[1]);
          break;
        }
      }
    } catch {
      // No claude processes found
    }

    if (!pid) {
      // Can't find process, just mark as ended
      handleEvent({
        session_id: session.sessionId,
        cwd: session.cwd,
        hook_event_name: 'SessionEnd',
        reason: 'killed_from_dashboard',
      });
      return { ok: true, sessionId: session.sessionId, method: 'marked_ended' };
    }

    try {
      process.kill(pid, 'SIGTERM');
      // Give it a moment then update status
      handleEvent({
        session_id: session.sessionId,
        cwd: session.cwd,
        hook_event_name: 'SessionEnd',
        reason: 'killed_from_dashboard',
      });
      return { ok: true, sessionId: session.sessionId, pid, method: 'sigterm' };
    } catch {
      return reply.status(500).send({ error: `Failed to kill process ${pid}` });
    }
  });

  // Launch a new claude session in a terminal
  app.post<{ Body: { cwd: string; terminalApp?: string } }>('/api/sessions/launch', async (request, reply) => {
    const { cwd, terminalApp } = request.body;
    if (!cwd || typeof cwd !== 'string') {
      return reply.status(400).send({ error: 'cwd is required' });
    }

    const platform = process.platform;
    const terminal = terminalApp || process.env.TERM_PROGRAM || 'Terminal';

    try {
      if (platform === 'darwin') {
        if (terminal.toLowerCase().includes('iterm')) {
          exec(`osascript -e 'tell application "iTerm" to create window with default profile command "cd ${cwd} && claude"'`);
        } else {
          exec(`osascript -e 'tell application "Terminal" to do script "cd ${cwd} && claude"'`);
        }
      } else {
        // Linux fallback
        exec(`x-terminal-emulator -e "cd ${cwd} && claude" 2>/dev/null || gnome-terminal -- bash -c "cd ${cwd} && claude; exec bash" 2>/dev/null || xterm -e "cd ${cwd} && claude" &`);
      }
      return { ok: true, cwd, terminal };
    } catch {
      return reply.status(500).send({ error: 'Failed to launch terminal' });
    }
  });
}
