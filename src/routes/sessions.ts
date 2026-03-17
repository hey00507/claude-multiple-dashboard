import type { FastifyInstance } from 'fastify';
import { execSync, exec } from 'child_process';
import { getAllSessions, getSession, renameSession, deleteSession, handleEvent, togglePin } from '../services/session-store.js';
import { deleteLogsBySessionId } from '../services/log-store.js';
import { createPty, findPtyBySessionId, getAllPtySessions } from '../services/pty-manager.js';
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
    const logsDeleted = deleteLogsBySessionId(request.params.sessionId);
    return { ok: true, sessionId: request.params.sessionId, logsDeleted };
  });

  // Bulk delete all inactive (ended/disconnected) sessions with their logs
  app.delete('/api/sessions', async () => {
    const sessions = getAllSessions();
    const ACTIVE_STATUSES: SessionStatus[] = ['active', 'waiting_input', 'waiting_permission'];
    const inactive = sessions.filter(s => !ACTIVE_STATUSES.includes(s.status));

    let deletedSessions = 0;
    let deletedLogs = 0;

    for (const s of inactive) {
      deleteSession(s.sessionId);
      deletedLogs += deleteLogsBySessionId(s.sessionId);
      deletedSessions++;
    }

    return { ok: true, deletedSessions, deletedLogs };
  });

  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/pin', async (request, reply) => {
    const session = togglePin(request.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return session;
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

  // Launch a new claude session
  app.post<{ Body: { cwd: string; mode?: 'terminal' | 'pty'; terminalApp?: string; args?: string[] } }>('/api/sessions/launch', async (request, reply) => {
    const { cwd, mode = 'pty', terminalApp, args } = request.body;
    if (!cwd || typeof cwd !== 'string') {
      return reply.status(400).send({ error: 'cwd is required' });
    }

    // PTY mode: spawn claude in a server-owned PTY
    if (mode === 'pty') {
      try {
        const ptySession = createPty(cwd, args);
        return { ok: true, ptyId: ptySession.ptyId, cwd: ptySession.cwd, mode: 'pty' };
      } catch (err: any) {
        return reply.status(500).send({ error: `Failed to create PTY: ${err.message}` });
      }
    }

    // Terminal mode: open external terminal (backward compatible)
    const platform = process.platform;
    const terminal = (terminalApp || process.env.TERM_PROGRAM || 'Terminal').toLowerCase();
    const safeCwd = cwd.replace(/'/g, "'\\''");

    try {
      if (platform === 'darwin') {
        if (terminal.includes('ghostty')) {
          // Ghostty: open new window via CLI
          exec(`open -a Ghostty --args -e "cd '${safeCwd}' && claude"`);
        } else if (terminal.includes('iterm')) {
          exec(`osascript -e 'tell application "iTerm" to create window with default profile command "cd ${safeCwd} && claude"'`);
        } else if (terminal.includes('warp')) {
          exec(`open -a Warp --args --command "cd '${safeCwd}' && claude"`);
        } else if (terminal.includes('alacritty')) {
          exec(`open -a Alacritty --args -e /bin/zsh -l -c "cd '${safeCwd}' && claude"`);
        } else {
          exec(`osascript -e 'tell application "Terminal" to do script "cd ${safeCwd} && claude"'`);
        }
      } else {
        exec(`x-terminal-emulator -e "cd ${safeCwd} && claude" 2>/dev/null || gnome-terminal -- bash -c "cd ${safeCwd} && claude; exec bash" 2>/dev/null || xterm -e "cd ${safeCwd} && claude" &`);
      }
      return { ok: true, cwd, terminal: terminalApp || terminal, mode: 'terminal' };
    } catch {
      return reply.status(500).send({ error: 'Failed to launch terminal' });
    }
  });

  // Get PTY session info for a given session
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/pty', async (request, reply) => {
    const ptySession = findPtyBySessionId(request.params.sessionId);
    if (!ptySession) return reply.status(404).send({ error: 'No PTY session found' });
    return { ptyId: ptySession.ptyId, cwd: ptySession.cwd, createdAt: ptySession.createdAt };
  });
}
