import { execSync } from 'child_process';
import { getSessionsByStatus, handleEvent } from './session-store.js';
import { getAllPtySessions } from './pty-manager.js';

/**
 * Get PIDs of actual `claude` CLI processes (not claude-dash, Claude.app, etc.)
 * Returns a Map of PID → cwd
 */
function getClaudeProcesses(): Map<number, string> {
  const result = new Map<number, string>();
  try {
    // Find `claude` processes that are the actual CLI (not our dashboard or Claude.app)
    const output = execSync(
      "ps -eo pid,comm,args | grep -E '^\\s*[0-9]+\\s+claude\\s' | grep -v claude-dash",
      { encoding: 'utf-8' }
    );
    for (const line of output.trim().split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[0]);
      if (!pid) continue;

      // Try to get cwd via lsof
      try {
        const cwdLine = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | head -1`, { encoding: 'utf-8' }).trim();
        const cwd = cwdLine.startsWith('n') ? cwdLine.slice(1) : '';
        result.set(pid, cwd);
      } catch {
        result.set(pid, '');
      }
    }
  } catch {
    // No claude processes
  }
  return result;
}

export function startProcessScanner(intervalMs = 30_000) {
  setInterval(() => scanAndClean(), intervalMs);
}

export function scanAndClean(): { checked: number; ended: number; stillActive: number } {
  try {
    const activeSessions = getSessionsByStatus(['active', 'waiting_input', 'waiting_permission']);
    if (activeSessions.length === 0) return { checked: 0, ended: 0, stillActive: 0 };

    const claudeProcs = getClaudeProcesses();

    // PTY-managed sessions: skip (lifecycle is handled by pty-manager)
    const ptySessionIds = new Set(
      getAllPtySessions()
        .filter(p => p.sessionId && !p.exited)
        .map(p => p.sessionId)
    );

    let ended = 0;
    for (const session of activeSessions) {
      if (ptySessionIds.has(session.sessionId)) continue;

      // Check if any claude process is associated with this session
      let found = false;
      for (const [, cwd] of claudeProcs) {
        if (cwd && cwd === session.cwd) { found = true; break; }
      }

      if (!found) {
        // No matching process found → mark as ended
        handleEvent({
          session_id: session.sessionId,
          cwd: session.cwd,
          hook_event_name: 'SessionEnd',
          reason: 'process_not_found',
        });
        ended++;
      }
    }

    return { checked: activeSessions.length, ended, stillActive: activeSessions.length - ended };
  } catch {
    return { checked: 0, ended: 0, stillActive: 0 };
  }
}
