import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { randomUUID } from 'crypto';
import { handleEvent } from './session-store.js';

export interface PtySession {
  ptyProcess: IPty;
  ptyId: string;
  sessionId: string | null; // null until Claude reports its session_id via hook
  cwd: string;
  createdAt: string;
  scrollback: string[];     // ring buffer for reconnection
}

const MAX_SCROLLBACK = 5000;
const ptySessions = new Map<string, PtySession>();

type DataCallback = (ptyId: string, data: string) => void;
type ExitCallback = (ptyId: string, code: number) => void;

const dataListeners = new Set<DataCallback>();
const exitListeners = new Set<ExitCallback>();

export function onData(cb: DataCallback) { dataListeners.add(cb); return () => dataListeners.delete(cb); }
export function onExit(cb: ExitCallback) { exitListeners.add(cb); return () => exitListeners.delete(cb); }

export function createPty(cwd: string, args: string[] = []): PtySession {
  const ptyId = `pty-${randomUUID().slice(0, 8)}`;
  const shell = process.env.SHELL || '/bin/zsh';

  // Build the command: run claude inside the user's shell so PATH is correct
  const claudeCmd = args.length > 0
    ? `claude ${args.join(' ')}`
    : 'claude';

  const ptyProcess = pty.spawn(shell, ['-l', '-c', claudeCmd], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
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
    cwd,
    createdAt: new Date().toISOString(),
    scrollback: [],
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
    ptySessions.delete(ptyId);
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
