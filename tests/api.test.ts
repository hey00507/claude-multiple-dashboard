import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = path.join(os.tmpdir(), `claude-dash-api-test-${Date.now()}`);
process.env.CLAUDE_DASH_DATA_DIR = tmpDir;

const { createServer } = await import('../src/server.js');

const app = await createServer();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  // Clean sessions and logs between tests
  for (const sub of ['sessions', 'logs']) {
    const dir = path.join(tmpDir, sub);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  }
});

describe('POST /api/events', () => {
  it('creates session on valid event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: {
        session_id: 'api-test-001',
        cwd: '/tmp/my-project',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('active');
  });

  it('returns 400 on missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { cwd: '/tmp' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('skips Stop event with stop_hook_active true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: {
        session_id: 'api-test-002',
        cwd: '/tmp',
        hook_event_name: 'Stop',
        stop_hook_active: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe(true);
  });
});

describe('GET /api/sessions', () => {
  it('returns empty array when no sessions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('returns sessions after events', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { session_id: 'sess-1', cwd: '/tmp/a', hook_event_name: 'SessionStart' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    const sessions = JSON.parse(res.body);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('sess-1');
  });

  it('filters by status', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { session_id: 'sess-active', cwd: '/tmp/a', hook_event_name: 'SessionStart' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { session_id: 'sess-active', cwd: '/tmp/a', hook_event_name: 'Stop' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/sessions?status=waiting_input' });
    const sessions = JSON.parse(res.body);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('waiting_input');
  });
});

describe('GET /api/sessions/:sessionId', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('returns session details', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { session_id: 'detail-001', cwd: '/tmp/proj', hook_event_name: 'SessionStart' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/sessions/detail-001' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).sessionId).toBe('detail-001');
  });
});

describe('DELETE /api/sessions/:id (with logs)', () => {
  it('deletes session and associated logs', async () => {
    // Create session + generate logs
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'del-001', cwd: '/tmp/del', hook_event_name: 'SessionStart' },
    });
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'del-001', cwd: '/tmp/del', hook_event_name: 'SessionEnd', reason: 'exit' },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/del-001' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.logsDeleted).toBeGreaterThanOrEqual(1);

    // Verify session is gone
    const sessRes = await app.inject({ method: 'GET', url: '/api/sessions/del-001' });
    expect(sessRes.statusCode).toBe(404);
  });
});

describe('DELETE /api/sessions (bulk)', () => {
  it('deletes all inactive sessions', async () => {
    // Create active session
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'bulk-active', cwd: '/tmp/a', hook_event_name: 'SessionStart' },
    });
    // Create ended session
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'bulk-ended', cwd: '/tmp/b', hook_event_name: 'SessionStart' },
    });
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'bulk-ended', cwd: '/tmp/b', hook_event_name: 'SessionEnd' },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/sessions' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.deletedSessions).toBe(1);

    // Active session should still exist
    const sessions = JSON.parse((await app.inject({ method: 'GET', url: '/api/sessions' })).body);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('bulk-active');
  });
});

describe('GET /api/logs', () => {
  it('returns logs for today', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: { session_id: 'log-001', cwd: '/tmp', hook_event_name: 'SessionStart' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/logs' });
    const logs = JSON.parse(res.body);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].sessionId).toBe('log-001');
  });
});

describe('GET /api/stats', () => {
  it('returns stats for today', async () => {
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'stats-001', cwd: '/tmp/s', hook_event_name: 'SessionStart' },
    });
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'stats-001', cwd: '/tmp/s', hook_event_name: 'UserPromptSubmit', prompt: 'hello' },
    });
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'stats-001', cwd: '/tmp/s', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
    });
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'stats-001', cwd: '/tmp/s', hook_event_name: 'Stop', last_assistant_message: 'done' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    const stats = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(stats.totalEvents).toBe(4);
    expect(stats.prompts).toBe(1);
    expect(stats.responses).toBe(1);
    expect(stats.sessions).toBe(1);
    expect(stats.tools).toEqual({ Bash: 1 });
  });

  it('returns empty stats for date with no logs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats?date=2020-01-01' });
    const stats = JSON.parse(res.body);

    expect(stats.totalEvents).toBe(0);
    expect(stats.prompts).toBe(0);
  });
});
