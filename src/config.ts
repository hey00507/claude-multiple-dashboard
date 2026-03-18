import path from 'path';
import fs from 'fs';
import os from 'os';

export const DATA_DIR = process.env.CLAUDE_DASH_DATA_DIR
  || path.join(process.env.HOME || '~', '.claude-dashboard');

export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const DEFAULT_PORT = 7420;

// Paths that are too generic for sessionDefaults matching
const EXCLUDED_CWDS = new Set([
  os.homedir(),
  '/',
  '/tmp',
]);

export interface SessionDefault {
  name?: string;
  color?: string;
}

interface DashConfig {
  sessionDefaults?: Record<string, SessionDefault>;
  [key: string]: unknown;
}

let configCache: DashConfig | null = null;
let configMtime = 0;

function loadConfig(): DashConfig {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (configCache && stat.mtimeMs === configMtime) return configCache;
    configCache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    configMtime = stat.mtimeMs;
    return configCache!;
  } catch {
    return {};
  }
}

function saveConfig(config: DashConfig): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  configCache = config;
  try { configMtime = fs.statSync(CONFIG_PATH).mtimeMs; } catch { /* */ }
}

/** Get session defaults for a cwd, or null if not found / excluded */
export function getSessionDefault(cwd: string): SessionDefault | null {
  if (EXCLUDED_CWDS.has(cwd)) return null;
  const config = loadConfig();
  return config.sessionDefaults?.[cwd] ?? null;
}

/** Get all session defaults */
export function getAllSessionDefaults(): Record<string, SessionDefault> {
  const config = loadConfig();
  return config.sessionDefaults ?? {};
}

/** Save a session default for a cwd */
export function setSessionDefault(cwd: string, defaults: SessionDefault): void {
  const config = loadConfig();
  if (!config.sessionDefaults) config.sessionDefaults = {};
  config.sessionDefaults[cwd] = defaults;
  saveConfig(config);
}

/** Remove a session default for a cwd */
export function removeSessionDefault(cwd: string): boolean {
  const config = loadConfig();
  if (!config.sessionDefaults?.[cwd]) return false;
  delete config.sessionDefaults[cwd];
  saveConfig(config);
  return true;
}

/** Check if a cwd is excluded from sessionDefaults matching */
export function isExcludedCwd(cwd: string): boolean {
  return EXCLUDED_CWDS.has(cwd);
}
