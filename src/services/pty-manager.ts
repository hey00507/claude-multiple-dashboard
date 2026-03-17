import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import os from 'os';
import { randomUUID } from 'crypto';
import { handleEvent } from './session-store.js';

export interface PtySession {
  ptyProcess: IPty;
  ptyId: string;
  sessionId: string | null; // null until Claude reports its session_id via hook
  cwd: string;
  createdAt: string;
  scrollback: string[];     // ring buffer for reconnection
  exited: boolean;
  exitCode: number | null;
}

const MAX_SCROLLBACK = 5000;
const PTY_LINGER_MS = 30_000; // keep exited PTY in map for 30s so WS can get exit message
const ptySessions = new Map<string, PtySession>();

/** Expand ~ to home directory (node-pty doesn't do this) */
function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return os.homedir() + p.slice(1);
  }
  return p;
}

type DataCallback = (ptyId: string, data: string) => void;
type ExitCallback = (ptyId: string, code: number) => void;

const dataListeners = new Set<DataCallback>();
const exitListeners = new Set<ExitCallback>();

export function onData(cb: DataCallback) { dataListeners.add(cb); return () => dataListeners.delete(cb); }
export function onExit(cb: ExitCallback) { exitListeners.add(cb); return () => exitListeners.delete(cb); }

export function createPty(cwd: string, args: string[] = []): PtySession {
  const ptyId = `pty-${randomUUID().slice(0, 8)}`;
  const shell = process.env.SHELL || '/bin/zsh';
  const resolvedCwd = expandHome(cwd);

  // Build the command: run claude inside the user's shell so PATH is correct
  const claudeCmd = args.length > 0
    ? `claude ${args.join(' ')}`
    : 'claude';

  const ptyProcess = pty.spawn(shell, ['-l', '-c', claudeCmd], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  const session: PtySession = {
    ptyProcess,
    ptyId,
    sessionId: null,
    cwd: resolvedCwd,
    createdAt: new Date().toISOString(),
    scrollback: [],
    exited: false,
    exitCode: null,
  };

  ptyProcess.onData((data: string) => {
    // Append to scrollback ring buffer
    session.scrollback.push(data);
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback.splice(0, session.scrollback.length - MAX_SCROLLBACK);
    }
    for (const cb of dataListeners) cb(ptyId, data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;

    for (const cb of exitListeners) cb(ptyId, exitCode);

    // If we have a linked session, mark it ended
    if (session.sessionId) {
      handleEvent({
        session_id: session.sessionId,
        cwd: session.cwd,
        hook_event_name: 'SessionEnd',
        reason: 'pty_exited',
      });
    }

    // Keep in map briefly so WebSocket can deliver exit message
    setTimeout(() => ptySessions.delete(ptyId), PTY_LINGER_MS);
  });

  ptySessions.set(ptyId, session);
  return session;
}

export function writePty(ptyId: string, data: string): boolean {
  const session = ptySessions.get(ptyId);
  if (!session) return false;
  session.ptyProcess.write(data);
  return true;
}

export function resizePty(ptyId: string, cols: number, rows: number): boolean {
  const session = ptySessions.get(ptyId);
  if (!session) return false;
  session.ptyProcess.resize(cols, rows);
  return true;
}

export function killPty(ptyId: string): boolean {
  const session = ptySessions.get(ptyId);
  if (!session) return false;
  session.ptyProcess.kill();
  return true;
}

export function getPty(ptyId: string): PtySession | null {
  return ptySessions.get(ptyId) || null;
}

export function getAllPtySessions(): PtySession[] {
  return Array.from(ptySessions.values());
}

/** Link a Claude session_id (from hook) to a PTY session by matching cwd */
export function linkSessionToPty(sessionId: string, cwd: string): boolean {
  for (const session of ptySessions.values()) {
    if (!session.sessionId && session.cwd === cwd) {
      session.sessionId = sessionId;
      return true;
    }
  }
  return false;
}

export function findPtyBySessionId(sessionId: string): PtySession | null {
  for (const session of ptySessions.values()) {
    if (session.sessionId === sessionId) return session;
  }
  return null;
}

export function getScrollback(ptyId: string): string {
  const session = ptySessions.get(ptyId);
  if (!session) return '';
  return session.scrollback.join('');
}
