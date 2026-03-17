import { state, PAGE_SIZE } from './state.js';
import { todayStr, formatDuration, truncate } from './utils.js';
// (renderSessions imported in sessions.js)
import { renderSessions } from './sessions.js';
import { renderHistory, updateProjectFilter, fetchStats } from './history.js';
import { openDetail } from './detail.js';
import { isGridVisible, refreshGrid } from './terminal-grid.js';

export function updateTabTitle() {
  const waiting = state.sessions.filter(s => s.status === 'waiting_input' || s.status === 'waiting_permission');
  const base = 'Claude Dashboard';
  document.title = waiting.length > 0 ? `(${waiting.length}) ${base}` : base;
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => { state.notificationsEnabled = p === 'granted'; });
  } else {
    state.notificationsEnabled = Notification.permission === 'granted';
  }
}

function sendIdleNotification(session) {
  if (!state.notificationsEnabled || document.hasFocus()) return;
  const n = new Notification(`${session.projectName} — 입력 대기 중`, {
    body: session.lastResponse ? truncate(session.lastResponse, 100) : '응답 완료',
    tag: session.sessionId,
  });
  setTimeout(() => n.close(), 8000);
}

let statsDebounce = null;
function debouncedFetchStats() {
  clearTimeout(statsDebounce);
  statsDebounce = setTimeout(() => fetchStats(), 500);
}

export function connectSSE() {
  const source = new EventSource('/api/events/stream');

  source.addEventListener('session_update', (e) => {
    const updated = JSON.parse(e.data);
    const idx = state.sessions.findIndex(s => s.sessionId === updated.sessionId);
    const prev = idx >= 0 ? state.sessions[idx] : null;

    if (prev && prev.status === 'active' && (updated.status === 'waiting_input' || updated.status === 'waiting_permission')) {
      sendIdleNotification(updated);
    }

    if (idx >= 0) {
      state.sessions[idx] = updated;
    } else {
      state.sessions.unshift(updated);
    }
    renderSessions();
    updateTabTitle();
    if (isGridVisible()) refreshGrid();

    if (state.selectedSessionId === updated.sessionId) {
      openDetail(updated.sessionId);
    }
  });

  source.addEventListener('log_update', (e) => {
    const log = JSON.parse(e.data);

    if (state.historyDate === todayStr()) {
      state.historyLogs.unshift(log);
      if (state.historyLogs.length > PAGE_SIZE) state.historyLogs.pop();
      updateProjectFilter();
      renderHistory();
      debouncedFetchStats();
    }

    if (state.selectedSessionId === log.sessionId) {
      openDetail(log.sessionId);
    }
  });

  source.onerror = () => {
    source.close();
    setTimeout(connectSSE, 3000);
  };
}

// Idle timer + elapsed time updater
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll('.idle-time[data-since]').forEach(el => {
    const since = new Date(el.dataset.since).getTime();
    el.textContent = `⏱ idle ${formatDuration(now - since)}`;
  });
  document.querySelectorAll('.session-meta[data-started]').forEach(el => {
    const started = new Date(el.dataset.started).getTime();
    const text = el.textContent;
    // Replace the elapsed time portion (⏱ ...)
    el.textContent = text.replace(/⏱ [\d:]+/, `⏱ ${formatDuration(now - started)}`);
  });
  updateTabTitle();
}, 1000);
