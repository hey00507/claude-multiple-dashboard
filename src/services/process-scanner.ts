import { execSync } from 'child_process';
import { getSessionsByStatus, handleEvent } from './session-store.js';
import { getAllPtySessions } from './pty-manager.js';

export function startProcessScanner(intervalMs = 30_000) {
  setInterval(() => {
    try {
      const activeSessions = getSessionsByStatus(['active', 'waiting_input', 'waiting_permission']);
      if (activeSessions.length === 0) return;

      // Get all running claude process PIDs and their cwds
      let claudeProcesses: { pid: number; cmd: string }[] = [];
      try {
        const output = execSync("ps -eo pid,args | grep '[c]laude'", { encoding: 'utf-8' });
        claudeProcesses = output.trim().split('\n').filter(Boolean).map(line => {
          const parts = line.trim().split(/\s+/);
          return { pid: Number(parts[0]), cmd: parts.slice(1).join(' ') };
        });
      } catch {
        // No claude processes at all
      }

      // Get active PTY session IDs (these are managed by us, don't mark them dead based on ps)
      const ptySessionIds = new Set(
        getAllPtySessions()
          .filter(p => p.sessionId && !p.exited)
          .map(p => p.sessionId)
      );

      for (const session of activeSessions) {
        // Skip PTY-managed sessions — their lifecycle is handled by pty-manager
        if (ptySessionIds.has(session.sessionId)) continue;

        // Check if any claude process matches this session
        const hasProcess = claudeProcesses.some(p =>
          p.cmd.includes(session.sessionId) || p.cmd.includes(session.cwd)
        );

        if (!hasProcess) {
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
