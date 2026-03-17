import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set temp data dir before importing modules
const tmpDir = path.join(os.tmpdir(), `claude-dash-pty-test-${Date.now()}`);
process.env.CLAUDE_DASH_DATA_DIR = tmpDir;

// Mock node-pty to avoid sandbox spawn issues
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 12345,
};

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => mockPtyProcess),
  },
  spawn: vi.fn(() => mockPtyProcess),
}));

const {
  createPty, getPty, getAllPtySessions, writePty, resizePty,
  killPty, linkSessionToPty, findPtyBySessionId, getScrollback,
} = await import('../src/services/pty-manager.js');

beforeEach(() => {
  fs.mkdirSync(path.join(tmpDir, 'sessions'), { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pty-manager', () => {
  it('creates a PTY session with correct metadata', () => {
    const cwd = '/tmp/test-project';
    const session = createPty(cwd, ['--help']);
    expect(session.ptyId).toMatch(/^pty-/);
    expect(session.cwd).toBe(cwd);
    expect(session.sessionId).toBeNull();
    expect(session.createdAt).toBeTruthy();
    expect(session.scrollback).toEqual([]);

    // Should be retrievable
    expect(getPty(session.ptyId)).toBe(session);
    expect(getAllPtySessions()).toContain(session);
  });

  it('returns null for non-existent PTY', () => {
    expect(getPty('nonexistent')).toBeNull();
  });

  it('handles write to non-existent PTY gracefully', () => {
    expect(writePty('nonexistent', 'data')).toBe(false);
  });

  it('writes data to existing PTY', () => {
    const session = createPty('/tmp', []);
    expect(writePty(session.ptyId, 'hello')).toBe(true);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('hello');
  });

  it('handles resize of non-existent PTY gracefully', () => {
    expect(resizePty('nonexistent', 80, 24)).toBe(false);
  });

  it('resizes existing PTY', () => {
    const session = createPty('/tmp', []);
    expect(resizePty(session.ptyId, 100, 50)).toBe(true);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(100, 50);
  });

  it('handles kill of non-existent PTY gracefully', () => {
    expect(killPty('nonexistent')).toBe(false);
  });

  it('kills existing PTY', () => {
    const session = createPty('/tmp', []);
    expect(killPty(session.ptyId)).toBe(true);
    expect(mockPtyProcess.kill).toHaveBeenCalled();
  });

  it('links session to PTY by cwd', () => {
    const cwd = '/tmp/my-project';
    const session = createPty(cwd, []);

    const linked = linkSessionToPty('test-session-123', cwd);
    expect(linked).toBe(true);
    expect(session.sessionId).toBe('test-session-123');

    const found = findPtyBySessionId('test-session-123');
    expect(found).toBe(session);
  });

  it('does not link if no matching cwd', () => {
    createPty('/tmp/project-a', []);
    const linked = linkSessionToPty('test-session-123', '/nonexistent/path');
    expect(linked).toBe(false);
  });

  it('does not link if already linked', () => {
    const cwd = '/tmp/project-b';
    createPty(cwd, []);
    linkSessionToPty('session-1', cwd);

    // Second link attempt should fail (session already linked)
    const linked2 = linkSessionToPty('session-2', cwd);
    expect(linked2).toBe(false);
  });

  it('returns null for unfound session ID', () => {
    expect(findPtyBySessionId('nonexistent')).toBeNull();
  });

  it('scrollback is empty for non-existent PTY', () => {
    expect(getScrollback('nonexistent')).toBe('');
  });

  it('registers onData and onExit callbacks', () => {
    createPty('/tmp', []);
    expect(mockPtyProcess.onData).toHaveBeenCalled();
    expect(mockPtyProcess.onExit).toHaveBeenCalled();
  });
});
