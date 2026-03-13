import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = path.join(os.tmpdir(), `claude-dash-log-test-${Date.now()}`);
process.env.CLAUDE_DASH_DATA_DIR = tmpDir;

const { appendLog, getLogs, deleteLogs } = await import('../src/services/log-store.js');

const TEST_SESSION = 'log-test-001';

function makeInput(event: string, extra: Record<string, unknown> = {}) {
  return { session_id: TEST_SESSION, cwd: '/tmp/test', hook_event_name: event, ...extra };
}

beforeEach(() => {
  fs.mkdirSync(path.join(tmpDir, 'logs'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('log-store', () => {
  describe('appendLog', () => {
    it('creates JSONL file and appends event', () => {
      appendLog(makeInput('SessionStart', { source: 'startup' }));

      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(tmpDir, 'logs', today, `${TEST_SESSION}.jsonl`);
      expect(fs.existsSync(logFile)).toBe(true);

      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);

      const event = JSON.parse(lines[0]);
      expect(event.event).toBe('SessionStart');
      expect(event.sessionId).toBe(TEST_SESSION);
      expect(event.source).toBe('startup');
    });

    it('appends multiple events to same file', () => {
      appendLog(makeInput('SessionStart'));
      appendLog(makeInput('PostToolUse', { tool_name: 'Edit' }));
      appendLog(makeInput('Stop'));

      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(tmpDir, 'logs', today, `${TEST_SESSION}.jsonl`);
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('records prompt from UserPromptSubmit', () => {
      appendLog(makeInput('UserPromptSubmit', { message: '리팩터링해줘' }));

      const logs = getLogs();
      expect(logs[0].prompt).toBe('리팩터링해줘');
    });

    it('records tool info from PostToolUse', () => {
      appendLog(makeInput('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));

      const logs = getLogs();
      expect(logs[0].tool).toBe('Bash');
      expect(logs[0].input).toEqual({ command: 'npm test' });
    });
  });

  describe('getLogs', () => {
    it('returns empty array for no logs', () => {
      expect(getLogs('2020-01-01')).toEqual([]);
    });

    it('returns logs sorted by time descending', () => {
      appendLog(makeInput('SessionStart'));
      appendLog(makeInput('PostToolUse', { tool_name: 'Read' }));
      appendLog(makeInput('Stop'));

      const logs = getLogs();
      expect(logs).toHaveLength(3);
      expect(new Date(logs[0].ts).getTime()).toBeGreaterThanOrEqual(new Date(logs[1].ts).getTime());
    });

    it('filters by sessionId', () => {
      appendLog(makeInput('SessionStart'));
      appendLog({ session_id: 'other-session', cwd: '/tmp', hook_event_name: 'SessionStart' });

      const logs = getLogs(undefined, TEST_SESSION);
      expect(logs).toHaveLength(1);
      expect(logs[0].sessionId).toBe(TEST_SESSION);
    });

    it('respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        appendLog(makeInput('PostToolUse', { tool_name: `Tool${i}` }));
      }

      const limited = getLogs(undefined, undefined, 2);
      expect(limited).toHaveLength(2);

      const offset = getLogs(undefined, undefined, 2, 3);
      expect(offset).toHaveLength(2);
    });
  });

  describe('deleteLogs', () => {
    it('deletes logs before specified date', () => {
      const oldDate = '2024-01-01';
      const oldDir = path.join(tmpDir, 'logs', oldDate);
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(path.join(oldDir, 'test.jsonl'), '{"ts":"2024-01-01"}');

      const result = deleteLogs('2025-01-01');
      expect(result.deletedDays).toBe(1);
      expect(result.deletedFiles).toBe(1);
      expect(fs.existsSync(oldDir)).toBe(false);
    });

    it('keeps logs after specified date', () => {
      const recentDate = '2026-12-01';
      const recentDir = path.join(tmpDir, 'logs', recentDate);
      fs.mkdirSync(recentDir, { recursive: true });
      fs.writeFileSync(path.join(recentDir, 'test.jsonl'), '{}');

      deleteLogs('2026-01-01');
      expect(fs.existsSync(recentDir)).toBe(true);
    });
  });
});
