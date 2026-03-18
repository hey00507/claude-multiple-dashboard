import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set temp data dir before importing modules
const tmpDir = path.join(os.tmpdir(), `claude-dash-defaults-test-${Date.now()}`);
process.env.CLAUDE_DASH_DATA_DIR = tmpDir;

const { getSessionDefault, getAllSessionDefaults, setSessionDefault, removeSessionDefault, isExcludedCwd } = await import('../src/config.js');
const { handleEvent, getSession } = await import('../src/services/session-store.js');

beforeEach(() => {
  fs.mkdirSync(path.join(tmpDir, 'sessions'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config - sessionDefaults', () => {
  it('returns null for unknown cwd', () => {
    expect(getSessionDefault('/unknown/path')).toBeNull();
  });

  it('saves and retrieves session defaults', () => {
    setSessionDefault('/proj/dashboard', { name: 'Dashboard', color: 'red' });
    const result = getSessionDefault('/proj/dashboard');
    expect(result).toEqual({ name: 'Dashboard', color: 'red' });
  });

  it('returns all session defaults', () => {
    setSessionDefault('/proj/a', { name: 'A', color: 'blue' });
    setSessionDefault('/proj/b', { name: 'B' });
    const all = getAllSessionDefaults();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['/proj/a']).toEqual({ name: 'A', color: 'blue' });
    expect(all['/proj/b']).toEqual({ name: 'B' });
  });

  it('removes a session default', () => {
    setSessionDefault('/proj/x', { name: 'X' });
    expect(removeSessionDefault('/proj/x')).toBe(true);
    expect(getSessionDefault('/proj/x')).toBeNull();
  });

  it('returns false when removing nonexistent default', () => {
    expect(removeSessionDefault('/nonexistent')).toBe(false);
  });

  it('excludes home directory', () => {
    expect(isExcludedCwd(os.homedir())).toBe(true);
    expect(isExcludedCwd('/')).toBe(true);
    expect(isExcludedCwd('/tmp')).toBe(true);
    expect(isExcludedCwd('/proj/dashboard')).toBe(false);
  });

  it('returns null for excluded cwds even if defaults exist', () => {
    // Directly write to config to bypass exclusion in setter
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      sessionDefaults: { [os.homedir()]: { name: 'Home', color: 'red' } }
    }));
    expect(getSessionDefault(os.homedir())).toBeNull();
  });

  it('preserves existing config fields when saving defaults', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ port: 7777, logRetentionDays: 30 }));
    setSessionDefault('/proj/a', { name: 'A' });
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.port).toBe(7777);
    expect(config.logRetentionDays).toBe(30);
    expect(config.sessionDefaults['/proj/a']).toEqual({ name: 'A' });
  });
});

describe('handleEvent - sessionDefaults integration', () => {
  it('applies defaults on SessionStart for matching cwd', () => {
    setSessionDefault('/proj/dashboard', { name: 'Dashboard', color: 'red' });

    const session = handleEvent({
      session_id: 'test-defaults-1',
      cwd: '/proj/dashboard',
      hook_event_name: 'SessionStart',
      source: 'startup',
    });

    expect(session.projectName).toBe('Dashboard');
    expect(session.customName).toBe(true);
    expect(session.color).toBe('red');
  });

  it('does not apply defaults for excluded cwds', () => {
    const session = handleEvent({
      session_id: 'test-defaults-2',
      cwd: os.homedir(),
      hook_event_name: 'SessionStart',
      source: 'startup',
    });

    // Should use basename fallback
    expect(session.projectName).toBe(path.basename(os.homedir()));
    expect(session.color).toBeUndefined();
  });

  it('does not override customName sessions', () => {
    setSessionDefault('/proj/dashboard', { name: 'Dashboard', color: 'red' });

    // First: create session with custom name
    handleEvent({ session_id: 'test-defaults-3', cwd: '/proj/dashboard', hook_event_name: 'SessionStart' });
    const session = getSession('test-defaults-3')!;
    session.projectName = 'My Custom Name';
    session.customName = true;
    // Save it
    const sessionFile = path.join(tmpDir, 'sessions', 'test-defaults-3.json');
    fs.writeFileSync(sessionFile, JSON.stringify(session));

    // Second SessionStart (e.g., resume)
    const resumed = handleEvent({ session_id: 'test-defaults-3', cwd: '/proj/dashboard', hook_event_name: 'SessionStart' });
    expect(resumed.projectName).toBe('My Custom Name');
  });

  it('applies only name when color is not set in defaults', () => {
    setSessionDefault('/proj/nameonly', { name: 'NameOnly' });

    const session = handleEvent({
      session_id: 'test-defaults-4',
      cwd: '/proj/nameonly',
      hook_event_name: 'SessionStart',
    });

    expect(session.projectName).toBe('NameOnly');
    expect(session.color).toBeUndefined();
  });

  it('applies only color when name is not set in defaults', () => {
    setSessionDefault('/proj/coloronly', { color: 'blue' });

    const session = handleEvent({
      session_id: 'test-defaults-5',
      cwd: '/proj/coloronly',
      hook_event_name: 'SessionStart',
    });

    // No name in defaults → falls back to basename
    expect(session.projectName).toBe('coloronly');
    expect(session.customName).toBe(false);
    expect(session.color).toBe('blue');
  });
});
