import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set temp data dir before importing modules
const tmpDir = path.join(os.tmpdir(), `claude-dash-test-${Date.now()}`);
process.env.CLAUDE_DASH_DATA_DIR = tmpDir;

const { handleEvent, getSession, getAllSessions, getSessionsByStatus } = await import('../src/services/session-store.js');

const TEST_CWD = '/Users/test/my-project';
const TEST_SESSION = 'test-session-001';

function makeInput(event: string, extra: Record<string, unknown> = {}) {
  return { session_id: TEST_SESSION, cwd: TEST_CWD, hook_event_name: event, ...extra };
}

beforeEach(() => {
  fs.mkdirSync(path.join(tmpDir, 'sessions'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('session-store', () => {
  describe('SessionStart', () => {
    it('creates a new session with active status', () => {
      const session = handleEvent(makeInput('SessionStart', { source: 'startup' }));

      expect(session.sessionId).toBe(TEST_SESSION);
      expect(session.status).toBe('active');
      expect(session.idleSince).toBeNull();
      expect(session.projectName).toBe('my-project');
      expect(session.totalEvents).toBe(1);
    });

    it('reactivates an ended session on resume', () => {
      handleEvent(makeInput('SessionStart'));
      handleEvent(makeInput('SessionEnd', { reason: 'prompt_input_exit' }));
      const session = handleEvent(makeInput('SessionStart', { source: 'resume' }));

      expect(session.status).toBe('active');
      expect(session.idleSince).toBeNull();
    });
  });

  describe('UserPromptSubmit', () => {
    it('sets status to active and records prompt', () => {
      handleEvent(makeInput('SessionStart'));
      handleEvent(makeInput('Stop'));
      const session = handleEvent(makeInput('UserPromptSubmit', { message: '테스트해줘' }));

      expect(session.status).toBe('active');
      expect(session.idleSince).toBeNull();
      expect(session.lastPrompt).toBe('테스트해줘');
    });
  });

  describe('PostToolUse', () => {
    it('sets status to active and records tool name', () => {
      handleEvent(makeInput('SessionStart'));
      const session = handleEvent(makeInput('PostToolUse', { tool_name: 'Edit' }));

      expect(session.status).toBe('active');
      expect(session.lastToolUsed).toBe('Edit');
      expect(session.idleSince).toBeNull();
    });
  });

  describe('Stop', () => {
    it('sets status to waiting_input and sets idleSince', () => {
      handleEvent(makeInput('SessionStart'));
      const session = handleEvent(makeInput('Stop'));

      expect(session.status).toBe('waiting_input');
      expect(session.idleSince).not.toBeNull();
    });
  });

  describe('Notification', () => {
    it('permission_prompt sets waiting_permission', () => {
      handleEvent(makeInput('SessionStart'));
      const session = handleEvent(makeInput('Notification', { notification_type: 'permission_prompt' }));

      expect(session.status).toBe('waiting_permission');
      expect(session.idleSince).not.toBeNull();
    });

    it('idle_prompt sets waiting_input', () => {
      handleEvent(makeInput('SessionStart'));
      const session = handleEvent(makeInput('Notification', { notification_type: 'idle_prompt' }));

      expect(session.status).toBe('waiting_input');
      expect(session.idleSince).not.toBeNull();
    });

    it('preserves existing idleSince if already idle', () => {
      handleEvent(makeInput('SessionStart'));
      const stopped = handleEvent(makeInput('Stop'));
      const idleSince = stopped.idleSince;

      const session = handleEvent(makeInput('Notification', { notification_type: 'idle_prompt' }));
      expect(session.idleSince).toBe(idleSince);
    });
  });

  describe('SessionEnd', () => {
    it('sets status to ended and clears idleSince', () => {
      handleEvent(makeInput('SessionStart'));
      handleEvent(makeInput('Stop'));
      const session = handleEvent(makeInput('SessionEnd', { reason: 'prompt_input_exit' }));

      expect(session.status).toBe('ended');
      expect(session.idleSince).toBeNull();
      expect(session.endedAt).not.toBeNull();
      expect(session.endReason).toBe('prompt_input_exit');
    });
  });

  describe('totalEvents', () => {
    it('increments on every event', () => {
      handleEvent(makeInput('SessionStart'));
      handleEvent(makeInput('PostToolUse', { tool_name: 'Read' }));
      handleEvent(makeInput('PostToolUse', { tool_name: 'Edit' }));
      const session = handleEvent(makeInput('Stop'));

      expect(session.totalEvents).toBe(4);
    });
  });

  describe('getSession / getAllSessions / getSessionsByStatus', () => {
    it('retrieves session by id', () => {
      handleEvent(makeInput('SessionStart'));
      const session = getSession(TEST_SESSION);

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(TEST_SESSION);
    });

    it('returns null for unknown session', () => {
      expect(getSession('nonexistent')).toBeNull();
    });

    it('lists all sessions', () => {
      handleEvent(makeInput('SessionStart'));
      handleEvent({ session_id: 'session-002', cwd: '/tmp/other', hook_event_name: 'SessionStart' });

      expect(getAllSessions()).toHaveLength(2);
    });

    it('filters by status', () => {
      handleEvent(makeInput('SessionStart'));
      handleEvent(makeInput('Stop'));
      handleEvent({ session_id: 'session-002', cwd: '/tmp/other', hook_event_name: 'SessionStart' });

      const waiting = getSessionsByStatus(['waiting_input']);
      expect(waiting).toHaveLength(1);
      expect(waiting[0].sessionId).toBe(TEST_SESSION);
    });
  });
});
