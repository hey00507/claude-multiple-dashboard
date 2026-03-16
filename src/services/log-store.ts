import fs from 'fs';
import path from 'path';
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
  fs.appendFileSync(filePath, JSON.stringify(logEvent) + '\n');
  eventBus.broadcastLog(logEvent);
}

export function getLogs(date?: string, sessionId?: string, limit = 100, offset = 0): LogEvent[] {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const dir = path.join(LOGS_DIR, targetDate);

  if (!fs.existsSync(dir)) return [];

  const files = sessionId
    ? [`${sessionId}.jsonl`]
    : fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));

  const allEvents: LogEvent[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      allEvents.push(JSON.parse(line));
    }
  }

  allEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return allEvents.slice(offset, offset + limit);
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
