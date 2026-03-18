import { todayStr } from './utils.js';

export const STATUS_ICONS = {
  active: '🟢',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  ended: '⚪',
  disconnected: '🔴',
};

export const STATUS_ORDER = {
  active: 0,
  waiting_permission: 1,
  waiting_input: 2,
  disconnected: 3,
  ended: 4,
};

export const ACTIVE_STATUSES = ['active', 'waiting_input', 'waiting_permission'];
export const PAGE_SIZE = 200;

// Mutable shared state
export const state = {
  sessions: [],
  historyLogs: [],
  historyDate: todayStr(),
  historyOffset: 0,
  historyHasMore: false,
  selectedSessionId: null,
  activeEventFilter: 'all',
  activeProjectFilter: 'all',
  searchQuery: '',
  notificationsEnabled: false,
  inactiveSessionsOpen: false,
  activeTab: 'timeline',       // 'timeline' | 'terminal'
  activePtyId: null,           // current PTY session ID for terminal tab
  gridVisible: false,          // true when terminal grid view is shown
};
