import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { HookInput, LogEvent } from '../types.js';
import { LOGS_DIR } from '../config.js';
import { eventBus } from './event-bus.js';

function todayDir(): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOGS_DIR, date);
}

export function appendLog(input: HookInput) {
  const dir = todayDir();
  fs.mkdirSync(dir, { recursive: true });

  const logEvent: LogEvent = {
    ts: new Date().toISOString(),
    event: input.hook_event_name,
    sessionId: input.session_id,
  };

  if (input.cwd) logEvent.cwd = input.cwd;
  if (input.source) logEvent.source = input.source;
  if (input.reason) logEvent.reason = input.reason;
  if (input.tool_name) logEvent.tool = input.tool_name;
  if (input.tool_input) logEvent.input = input.tool_input;
  if (input.prompt) logEvent.prompt = input.prompt;
  if (input.last_assistant_message) logEvent.response = input.last_assistant_message;
  if (input.notification_type) logEvent.notificationType = input.notification_type;

  const filePath = path.join(dir, `${input.session_id}.jsonl`);
  const line = JSON.stringify(logEvent) + '\n';
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
  eventBus.broadcastLog(logEvent);
}

export function getLogs(date?: string, sessionId?: string, limit = 100, offset = 0, search?: string): LogEvent[] {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const dir = path.join(LOGS_DIR, targetDate);

  if (!fs.existsSync(dir)) return [];

  const allFiles = fs.readdirSync(dir);
  let files: string[];
  if (sessionId) {
    files = allFiles.filter(f => f === `${sessionId}.jsonl` || f === `${sessionId}.jsonl.gz`);
  } else {
    files = allFiles.filter(f => f.endsWith('.jsonl') || f.endsWith('.jsonl.gz'));
  }

  const allEvents: LogEvent[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    let content: string;
    if (file.endsWith('.gz')) {
      content = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf-8');
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try { allEvents.push(JSON.parse(line)); } catch { /* skip corrupted lines */ }
    }
  }

  let filtered = allEvents;
  if (search) {
    const q = search.toLowerCase();
    filtered = allEvents.filter(log =>
      (log.prompt && log.prompt.toLowerCase().includes(q)) ||
      (log.response && log.response.toLowerCase().includes(q)) ||
      (log.tool && log.tool.toLowerCase().includes(q)) ||
      (log.input?.file_path && String(log.input.file_path).toLowerCase().includes(q)) ||
      (log.input?.command && String(log.input.command).toLowerCase().includes(q))
    );
  }

  filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return filtered.slice(offset, offset + limit);
}

export interface DayStats {
  totalEvents: number;
  prompts: number;
  responses: number;
  tools: Record<string, number>;
  sessions: number;
  avgIdleGapMs: number;
}

export function getStats(date?: string): DayStats {
  const logs = getLogs(date, undefined, 10000, 0);
  const tools: Record<string, number> = {};
  let prompts = 0;
  let responses = 0;
  const sessionIds = new Set<string>();
  const stopTimes: number[] = [];
  const resumeTimes: number[] = [];

  for (const log of logs) {
    sessionIds.add(log.sessionId);
    if (log.prompt) prompts++;
    if (log.response) responses++;
    if (log.tool) tools[log.tool] = (tools[log.tool] || 0) + 1;
    if (log.event === 'Stop') stopTimes.push(new Date(log.ts).getTime());
    if (log.event === 'UserPromptSubmit') resumeTimes.push(new Date(log.ts).getTime());
  }

  // Calculate average idle gap: time between Stop and next UserPromptSubmit
  // Sort chronologically (logs are desc, so reverse)
  const chronLogs = [...logs].reverse();
  let totalIdleMs = 0;
  let idleCount = 0;
  let lastStopTime: number | null = null;

  for (const log of chronLogs) {
    if (log.event === 'Stop') {
      lastStopTime = new Date(log.ts).getTime();
    } else if (log.event === 'UserPromptSubmit' && lastStopTime !== null) {
      totalIdleMs += new Date(log.ts).getTime() - lastStopTime;
      idleCount++;
      lastStopTime = null;
    }
  }

  return {
    totalEvents: logs.length,
    prompts,
    responses,
    tools,
    sessions: sessionIds.size,
    avgIdleGapMs: idleCount > 0 ? Math.round(totalIdleMs / idleCount) : 0,
  };
}

export function deleteLogsBySessionId(sessionId: string): number {
  if (!fs.existsSync(LOGS_DIR)) return 0;

  let deleted = 0;
  const dirs = fs.readdirSync(LOGS_DIR);

  for (const dir of dirs) {
    const filePath = path.join(LOGS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }

  return deleted;
}

export function compressOldLogs(olderThanDays = 30): { compressedDays: number; compressedFiles: number } {
  if (!fs.existsSync(LOGS_DIR)) return { compressedDays: 0, compressedFiles: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const dirs = fs.readdirSync(LOGS_DIR);
  let compressedDays = 0;
  let compressedFiles = 0;

  for (const dir of dirs) {
    if (new Date(dir) >= cutoff) continue;
    const dirPath = path.join(LOGS_DIR, dir);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
    if (files.length === 0) continue;

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const gzPath = filePath + '.gz';
      if (fs.existsSync(gzPath)) continue; // already compressed
      const content = fs.readFileSync(filePath);
      fs.writeFileSync(gzPath, zlib.gzipSync(content));
      fs.unlinkSync(filePath);
      compressedFiles++;
    }
    compressedDays++;
  }

  return { compressedDays, compressedFiles };
}

export function deleteLogs(before: string): { deletedDays: number; deletedFiles: number } {
  if (!fs.existsSync(LOGS_DIR)) return { deletedDays: 0, deletedFiles: 0 };

  const beforeDate = new Date(before);
  const dirs = fs.readdirSync(LOGS_DIR);
  let deletedDays = 0;
  let deletedFiles = 0;

  for (const dir of dirs) {
    if (new Date(dir) < beforeDate) {
      const dirPath = path.join(LOGS_DIR, dir);
      const files = fs.readdirSync(dirPath);
      deletedFiles += files.length;
      fs.rmSync(dirPath, { recursive: true });
      deletedDays++;
    }
  }

  return { deletedDays, deletedFiles };
}
