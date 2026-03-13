import { execSync } from 'child_process';
import { getSessionsByStatus, handleEvent } from './session-store.js';

export function startProcessScanner(intervalMs = 30_000) {
  setInterval(() => {
    try {
      const activeSessions = getSessionsByStatus(['active', 'waiting_input', 'waiting_permission']);
      if (activeSessions.length === 0) return;

      let runningPids: Set<number>;
      try {
        const output = execSync("pgrep -f 'claude'", { encoding: 'utf-8' });
        runningPids = new Set(output.trim().split('\n').map(Number).filter(Boolean));
      } catch {
        runningPids = new Set();
      }

      for (const session of activeSessions) {
        // Session doesn't track PID directly, so we check if any claude process
        // is working in the session's cwd using lsof or by checking /proc
        // For now, if no claude processes exist at all, mark as disconnected
        if (runningPids.size === 0) {
          handleEvent({
            session_id: session.sessionId,
            cwd: session.cwd,
            hook_event_name: 'SessionEnd',
            reason: 'process_not_found',
          });
        }
      }
    } catch {
      // Scanner errors should not crash the server
    }
  }, intervalMs);
}
