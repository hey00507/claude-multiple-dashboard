import { execSync } from 'child_process';
import { getSessionsByStatus, handleEvent } from './session-store.js';
import { getAllPtySessions } from './pty-manager.js';

/**
 * Get PIDs of actual `claude` CLI processes (not claude-dash, Claude.app, etc.)
 */
function getClaudePids(): Set<number> {
  try {
    const output = execSync(
      "ps -eo pid,comm | grep -E '^\\s*[0-9]+\\s+claude$'",
      { encoding: 'utf-8' }
    );
    return new Set(
      output.trim().split('\n').filter(Boolean)
        .map(line => Number(line.trim().split(/\s+/)[0]))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

export function startProcessScanner(intervalMs = 30_000) {
  setInterval(() => scanAndClean(), intervalMs);
}

export function scanAndClean(): { checked: number; ended: number; stillActive: number } {
  try {
    const activeSessions = getSessionsByStatus(['active', 'waiting_input', 'waiting_permission']);
    if (activeSessions.length === 0) return { checked: 0, ended: 0, stillActive: 0 };

    const claudePids = getClaudePids();

    // PTY-managed sessions: skip (lifecycle handled by pty-manager)
    const ptySessionIds = new Set(
      getAllPtySessions()
        .filter(p => p.sessionId && !p.exited)
        .map(p => p.sessionId)
    );

    // If there are ANY claude processes running, don't end hook-based sessions.
    // We can't reliably map PID→session on macOS without /proc.
    // Only mark sessions as ended when zero claude processes exist.
    if (claudePids.size > 0) {
      // There are active claude processes — leave hook sessions alone
      const nonPtySessions = activeSessions.filter(s => !ptySessionIds.has(s.sessionId));
      return { checked: activeSessions.length, ended: 0, stillActive: activeSessions.length };
    }

    // No claude processes at all — end all non-PTY sessions
    let ended = 0;
    for (const session of activeSessions) {
      if (ptySessionIds.has(session.sessionId)) continue;

      handleEvent({
        session_id: session.sessionId,
        cwd: session.cwd,
        hook_event_name: 'SessionEnd',
        reason: 'process_not_found',
      });
      ended++;
    }

    return { checked: activeSessions.length, ended, stillActive: activeSessions.length - ended };
  } catch {
    return { checked: 0, ended: 0, stillActive: 0 };
  }
}
