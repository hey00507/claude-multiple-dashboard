import fs from 'fs';
import path from 'path';
import type { Session, SessionStatus, HookInput } from '../types.js';
import { SESSIONS_DIR } from '../config.js';
import { eventBus } from './event-bus.js';

function ensureDirs() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

function extractProjectName(cwd: string): string {
  return path.basename(cwd);
}

export function getSession(sessionId: string): Session | null {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function getAllSessions(): Session[] {
  ensureDirs();
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  return files
    .map(f => JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8')) as Session)
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
}

export function getSessionsByStatus(statuses: SessionStatus[]): Session[] {
  return getAllSessions().filter(s => statuses.includes(s.status));
}

export function renameSession(sessionId: string, newName: string): Session | null {
  const session = getSession(sessionId);
  if (!session) return null;
  session.projectName = newName;
  session.customName = true;
  saveSession(session);
  return session;
}

function saveSession(session: Session) {
  ensureDirs();
  fs.writeFileSync(sessionPath(session.sessionId), JSON.stringify(session, null, 2));
  eventBus.broadcast(session);
}

export function handleEvent(input: HookInput): Session {
  const now = new Date().toISOString();
  let session = getSession(input.session_id);

  if (!session) {
    session = {
      sessionId: input.session_id,
      cwd: input.cwd,
      projectName: extractProjectName(input.cwd),
      customName: false,
      status: 'active',
      startedAt: now,
      lastActivityAt: now,
      lastEvent: input.hook_event_name,
      lastPrompt: null,
      lastResponse: null,
      lastToolUsed: null,
      idleSince: null,
      endedAt: null,
      endReason: null,
      totalEvents: 0,
    };
  }

  session.lastActivityAt = now;
  session.lastEvent = input.hook_event_name;
  session.totalEvents++;

  switch (input.hook_event_name) {
    case 'SessionStart':
      session.status = 'active';
      session.idleSince = null;
      session.cwd = input.cwd;
      if (!session.customName) session.projectName = extractProjectName(input.cwd);
      break;

    case 'UserPromptSubmit':
      session.status = 'active';
      session.idleSince = null;
      session.lastPrompt = input.prompt || null;
      break;

    case 'PostToolUse':
      session.status = 'active';
      session.idleSince = null;
      session.lastToolUsed = input.tool_name || null;
      break;

    case 'Stop':
      session.status = 'waiting_input';
      session.idleSince = now;
      session.lastResponse = input.last_assistant_message || null;
      break;

    case 'Notification':
      if (input.notification_type === 'permission_prompt') {
        session.status = 'waiting_permission';
        if (!session.idleSince) session.idleSince = now;
      } else {
        session.status = 'waiting_input';
        if (!session.idleSince) session.idleSince = now;
      }
      break;

    case 'SessionEnd':
      session.status = 'ended';
      session.idleSince = null;
      session.endedAt = now;
      session.endReason = input.reason || null;
      break;
  }

  saveSession(session);
  return session;
}
