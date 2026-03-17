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

function atomicWrite(filePath: string, data: string) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function saveSession(session: Session) {
  ensureDirs();
  atomicWrite(sessionPath(session.sessionId), JSON.stringify(session, null, 2));
  eventBus.broadcast(session);
}

export function togglePin(sessionId: string): Session | null {
  const session = getSession(sessionId);
  if (!session) return null;
  session.pinned = !session.pinned;
  saveSession(session);
  return session;
}

export function deleteSession(sessionId: string): boolean {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function cleanEndedSessions(maxAgeMs = 24 * 60 * 60 * 1000): { deleted: number } {
  const sessions = getAllSessions();
  const now = Date.now();
  let deleted = 0;

  for (const session of sessions) {
    if (session.status !== 'ended' && session.status !== 'disconnected') continue;
    const endedAt = session.endedAt || session.lastActivityAt;
    const age = now - new Date(endedAt).getTime();
    if (age > maxAgeMs) {
      deleteSession(session.sessionId);
      deleted++;
    }
  }

  return { deleted };
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
};

function readTranscriptMeta(transcriptPath: string): { model?: string; contextTokens?: number; maxContextTokens?: number } {
  try {
    if (!fs.existsSync(transcriptPath)) return {};
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');

    let model: string | undefined;
    let lastInputTokens = 0;

    // Read last few assistant messages for most recent data
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message?.model) {
          model = entry.message.model;
          const usage = entry.message.usage;
          if (usage) {
            lastInputTokens = (usage.input_tokens || 0)
              + (usage.cache_read_input_tokens || 0)
              + (usage.cache_creation_input_tokens || 0)
              + (usage.output_tokens || 0);
          }
          break;
        }
      } catch { /* skip */ }
    }

    const maxContextTokens = model ? (MODEL_CONTEXT_LIMITS[model] || 200_000) : undefined;
    return { model, contextTokens: lastInputTokens || undefined, maxContextTokens };
  } catch {
    return {};
  }
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
  if (input.transcript_path && !session.transcriptPath) {
    session.transcriptPath = input.transcript_path;
  }

  switch (input.hook_event_name) {
    case 'SessionStart':
      session.status = 'active';
      session.idleSince = null;
      session.cwd = input.cwd;
      if (!session.customName) session.projectName = extractProjectName(input.cwd);
      if (input.transcript_path) session.transcriptPath = input.transcript_path;
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
      if (session.transcriptPath) {
        const meta = readTranscriptMeta(session.transcriptPath);
        if (meta.model) session.model = meta.model;
        if (meta.contextTokens) session.contextTokens = meta.contextTokens;
        if (meta.maxContextTokens) session.maxContextTokens = meta.maxContextTokens;
      }
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
