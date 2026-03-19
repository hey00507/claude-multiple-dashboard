import { execSync } from 'child_process';
import fs from 'fs';
import { getSessionsByStatus, handleEvent, setSessionDisconnected } from './session-store.js';
import type { Session } from '../types.js';

/**
 * Get PIDs of actual `claude` CLI processes (not claude-dash, Claude.app, etc.)
 * Excludes the dashboard server's own PID.
 */
function getClaudePids(): Set<number> {
  try {
    const output = execSync(
      "ps -eo pid,comm | grep -E '^\\s*[0-9]+\\s+claude$'",
      { encoding: 'utf-8', timeout: 5000 }
    );
    const selfPid = process.pid;
    return new Set(
      output.trim().split('\n').filter(Boolean)
        .map(line => Number(line.trim().split(/\s+/)[0]))
        .filter(pid => pid && pid !== selfPid)
    );
  } catch {
    return new Set();
  }
}

/**
 * Count top-level Claude session processes (exclude subagents).
 * A subagent's parent PID is another claude process.
 */
function countTopLevelClaudePids(): number {
  try {
    const output = execSync(
      "ps -eo pid,ppid,comm | grep -E '\\s+claude$'",
      { encoding: 'utf-8', timeout: 5000 }
    );

    const claudePids = new Set<number>();
    const entries: { pid: number; ppid: number }[] = [];

    for (const line of output.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[0]);
      const ppid = Number(parts[1]);
      if (pid && pid !== process.pid) {
        claudePids.add(pid);
        entries.push({ pid, ppid });
      }
    }

    // Top-level = parent is NOT another claude process
    let topLevel = 0;
    for (const { ppid } of entries) {
      if (!claudePids.has(ppid)) topLevel++;
    }

    return topLevel;
  } catch {
    return 0;
  }
}

/**
 * Get the modification time (epoch ms) of a transcript file.
 * Returns 0 if the file doesn't exist.
 */
function getTranscriptMtime(transcriptPath: string): number {
  try {
    return fs.statSync(transcriptPath).mtimeMs;
  } catch {
    return 0;
  }
}

export function startProcessScanner(intervalMs = 30_000) {
  setInterval(() => scanAndClean(), intervalMs);
}

export function scanAndClean(): { checked: number; ended: number; disconnected: number; stillActive: number } {
  try {
    const liveSessions = getSessionsByStatus(['active', 'waiting_input', 'waiting_permission', 'disconnected']);
    if (liveSessions.length === 0) return { checked: 0, ended: 0, disconnected: 0, stillActive: 0 };

    const hookSessions = liveSessions;

    const claudePids = getClaudePids();

    // No claude processes at all → end all hook sessions
    if (claudePids.size === 0) {
      let ended = 0;
      for (const session of hookSessions) {
        endSession(session);
        ended++;
      }
      return { checked: liveSessions.length, ended, disconnected: 0, stillActive: liveSessions.length - ended };
    }

    const topLevelCount = countTopLevelClaudePids();

    // Split: already-disconnected vs still-active
    const disconnectedSessions = hookSessions.filter(s => s.status === 'disconnected');
    const activeSessions = hookSessions.filter(s => s.status !== 'disconnected');

    let ended = 0;
    let disconnected = 0;

    // Escalate: disconnected sessions that survived one cycle → ended
    for (const session of disconnectedSessions) {
      endSession(session);
      ended++;
    }

    // Enough top-level processes for all active sessions → all alive
    if (topLevelCount >= activeSessions.length) {
      return {
        checked: liveSessions.length,
        ended,
        disconnected: 0,
        stillActive: liveSessions.length - ended,
      };
    }

    // Fewer processes than sessions → rank by transcript freshness
    // The freshest N sessions are likely alive; the rest are likely dead
    const sessionsWithMtime = activeSessions.map(s => ({
      session: s,
      mtime: s.transcriptPath ? getTranscriptMtime(s.transcriptPath) : 0,
    }));

    // Sort by mtime descending (freshest first)
    sessionsWithMtime.sort((a, b) => b.mtime - a.mtime);

    const aliveCount = topLevelCount;
    for (let i = 0; i < sessionsWithMtime.length; i++) {
      if (i < aliveCount) continue; // likely alive
      // Likely dead → mark disconnected (will be ended next scan cycle)
      setSessionDisconnected(sessionsWithMtime[i].session.sessionId);
      disconnected++;
    }

    return {
      checked: liveSessions.length,
      ended,
      disconnected,
      stillActive: liveSessions.length - ended - disconnected,
    };
  } catch {
    return { checked: 0, ended: 0, disconnected: 0, stillActive: 0 };
  }
}

function endSession(session: Session): void {
  handleEvent({
    session_id: session.sessionId,
    cwd: session.cwd,
    hook_event_name: 'SessionEnd',
    reason: 'process_not_found',
  });
}
