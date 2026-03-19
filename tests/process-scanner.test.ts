import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set temp data dir before importing modules
const tmpDir = path.join(os.tmpdir(), `claude-dash-scanner-test-${Date.now()}`);
process.env.CLAUDE_DASH_DATA_DIR = tmpDir;

// Mock child_process.execSync
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const { handleEvent, getSession, setSessionDisconnected } = await import('../src/services/session-store.js');
const { scanAndClean } = await import('../src/services/process-scanner.js');

function createSession(id: string, cwd: string, status: string, transcriptPath?: string) {
  // Create session via SessionStart, then move to desired status
  handleEvent({ session_id: id, cwd, hook_event_name: 'SessionStart', source: 'startup' });
  if (status === 'waiting_input') {
    handleEvent({ session_id: id, cwd, hook_event_name: 'Stop', last_assistant_message: 'done' });
  } else if (status === 'waiting_permission') {
    handleEvent({ session_id: id, cwd, hook_event_name: 'Notification', notification_type: 'permission_prompt' });
  } else if (status === 'disconnected') {
    handleEvent({ session_id: id, cwd, hook_event_name: 'Stop', last_assistant_message: 'done' });
    setSessionDisconnected(id);
  }
  // Set transcript path if provided
  if (transcriptPath) {
    const session = getSession(id)!;
    session.transcriptPath = transcriptPath;
    const sessionFile = path.join(tmpDir, 'sessions', `${id}.json`);
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  }
}

function mockPsOutput(pids: { pid: number; ppid: number }[]) {
  mockExecSync.mockImplementation((cmd: string) => {
    if (pids.length === 0) throw new Error('no processes');
    if (cmd.includes('pid,ppid,comm')) {
      // ps -eo pid,ppid,comm | grep claude
      return pids.map(p => `  ${p.pid}  ${p.ppid} claude`).join('\n') + '\n';
    }
    if (cmd.includes('pid,comm')) {
      // ps -eo pid,comm | grep claude
      return pids.map(p => `  ${p.pid} claude`).join('\n') + '\n';
    }
    throw new Error('unexpected command');
  });
}

beforeEach(() => {
  fs.mkdirSync(path.join(tmpDir, 'sessions'), { recursive: true });
  mockExecSync.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('process-scanner', () => {
  describe('no claude processes', () => {
    it('ends all hook sessions when zero claude processes exist', () => {
      createSession('s1', '/proj/a', 'active');
      createSession('s2', '/proj/b', 'waiting_input');
      mockPsOutput([]);

      const result = scanAndClean();
      expect(result.ended).toBe(2);
      expect(getSession('s1')!.status).toBe('ended');
      expect(getSession('s2')!.status).toBe('ended');
    });
  });

  describe('enough processes for all sessions', () => {
    it('keeps all sessions alive when process count >= session count', () => {
      createSession('s1', '/proj/a', 'active');
      createSession('s2', '/proj/b', 'waiting_input');
      mockPsOutput([
        { pid: 1001, ppid: 500 },
        { pid: 1002, ppid: 501 },
      ]);

      const result = scanAndClean();
      expect(result.ended).toBe(0);
      expect(result.disconnected).toBe(0);
      expect(getSession('s1')!.status).toBe('active');
      expect(getSession('s2')!.status).toBe('waiting_input');
    });

    it('ignores subagent processes when counting', () => {
      createSession('s1', '/proj/a', 'active');
      createSession('s2', '/proj/b', 'waiting_input');
      // 1001 is top-level, 1003 is subagent of 1001
      // Only 1 top-level process for 2 sessions
      mockPsOutput([
        { pid: 1001, ppid: 500 },
        { pid: 1003, ppid: 1001 },
      ]);

      const result = scanAndClean();
      // Only 1 top-level process < 2 sessions → 1 should be disconnected
      expect(result.disconnected).toBe(1);
    });
  });

  describe('fewer processes than sessions — transcript mtime ranking', () => {
    it('disconnects sessions with older transcripts', () => {
      // Create transcript files with different mtimes
      const transcriptDir = path.join(tmpDir, 'transcripts');
      fs.mkdirSync(transcriptDir, { recursive: true });

      const freshTranscript = path.join(transcriptDir, 'fresh.jsonl');
      const staleTranscript = path.join(transcriptDir, 'stale.jsonl');

      // Write files, then set different mtimes
      fs.writeFileSync(freshTranscript, '{}');
      fs.writeFileSync(staleTranscript, '{}');

      // Make stale transcript older
      const now = Date.now();
      fs.utimesSync(staleTranscript, new Date(now - 300_000), new Date(now - 300_000)); // 5 min ago
      fs.utimesSync(freshTranscript, new Date(now), new Date(now)); // now

      createSession('s-fresh', '/proj/a', 'active', freshTranscript);
      createSession('s-stale', '/proj/b', 'waiting_input', staleTranscript);

      // Only 1 claude process for 2 sessions
      mockPsOutput([{ pid: 1001, ppid: 500 }]);

      const result = scanAndClean();
      expect(result.disconnected).toBe(1);
      expect(getSession('s-fresh')!.status).toBe('active');
      expect(getSession('s-stale')!.status).toBe('disconnected');
    });

    it('disconnects sessions without transcript path first', () => {
      const transcriptDir = path.join(tmpDir, 'transcripts');
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcript = path.join(transcriptDir, 'has.jsonl');
      fs.writeFileSync(transcript, '{}');

      createSession('s-with', '/proj/a', 'active', transcript);
      createSession('s-without', '/proj/b', 'waiting_input'); // no transcript

      mockPsOutput([{ pid: 1001, ppid: 500 }]);

      const result = scanAndClean();
      expect(result.disconnected).toBe(1);
      // Session without transcript (mtime=0) should be disconnected
      expect(getSession('s-without')!.status).toBe('disconnected');
      expect(getSession('s-with')!.status).toBe('active');
    });
  });

  describe('disconnected → ended escalation', () => {
    it('ends sessions that were already disconnected from previous scan', () => {
      createSession('s1', '/proj/a', 'disconnected');
      mockPsOutput([]);

      const result = scanAndClean();
      expect(result.ended).toBe(1);
      expect(getSession('s1')!.status).toBe('ended');
    });

    it('ends disconnected sessions even if other processes exist', () => {
      createSession('s1', '/proj/a', 'active');
      createSession('s-disc', '/proj/b', 'disconnected');
      // 1 process, 1 active + 1 disconnected
      mockPsOutput([{ pid: 1001, ppid: 500 }]);

      const result = scanAndClean();
      expect(result.ended).toBe(1); // disconnected → ended
      expect(result.disconnected).toBe(0); // active stays (1 process >= 1 active session)
      expect(getSession('s1')!.status).toBe('active');
      expect(getSession('s-disc')!.status).toBe('ended');
    });
  });

  describe('no sessions to check', () => {
    it('returns zero counts when no live sessions exist', () => {
      mockPsOutput([]);
      const result = scanAndClean();
      expect(result).toEqual({ checked: 0, ended: 0, disconnected: 0, stillActive: 0 });
    });
  });

  describe('setSessionDisconnected', () => {
    it('sets active session to disconnected', () => {
      createSession('s1', '/proj/a', 'active');
      const result = setSessionDisconnected('s1');
      expect(result).toBe(true);
      expect(getSession('s1')!.status).toBe('disconnected');
    });

    it('returns false for already-ended sessions', () => {
      createSession('s1', '/proj/a', 'active');
      handleEvent({ session_id: 's1', cwd: '/proj/a', hook_event_name: 'SessionEnd', reason: 'exit' });
      const result = setSessionDisconnected('s1');
      expect(result).toBe(false);
    });

    it('returns false for non-existent sessions', () => {
      const result = setSessionDisconnected('nonexistent');
      expect(result).toBe(false);
    });
  });
});
