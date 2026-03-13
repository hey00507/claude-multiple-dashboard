import path from 'path';

export const DATA_DIR = process.env.CLAUDE_DASH_DATA_DIR
  || path.join(process.env.HOME || '~', '.claude-dashboard');

export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const DEFAULT_PORT = 7420;
