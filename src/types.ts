export type SessionStatus =
  | 'active'
  | 'waiting_input'
  | 'waiting_permission'
  | 'ended'
  | 'disconnected';

export interface Session {
  sessionId: string;
  cwd: string;
  projectName: string;
  customName: boolean;
  status: SessionStatus;
  startedAt: string;
  lastActivityAt: string;
  lastEvent: string;
  lastPrompt: string | null;
  lastResponse: string | null;
  lastToolUsed: string | null;
  idleSince: string | null;
  endedAt: string | null;
  endReason: string | null;
  totalEvents: number;
}

export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  source?: string;
  reason?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
  stop_hook_active?: boolean;
  prompt?: string;
  last_assistant_message?: string;
  transcript_path?: string;
  permission_mode?: string;
}

export interface LogEvent {
  ts: string;
  event: string;
  sessionId: string;
  cwd?: string;
  source?: string;
  reason?: string;
  tool?: string;
  input?: Record<string, unknown>;
  prompt?: string;
  response?: string;
  notificationType?: string;
}
