import { state } from './state.js';
import { truncate } from './utils.js';

// --- Notification Settings (localStorage persisted) ---

const STORAGE_KEY = 'claude-dash-notification-settings';
const HISTORY_KEY = 'claude-dash-notification-history';
const MAX_HISTORY = 50;

const DEFAULT_SETTINGS = {
  enabled: true,
  sound: false,
  conditions: {
    waiting_input: true,
    waiting_permission: true,
    disconnected: true,
    ended: false,
    idle_threshold: false,
  },
  idleMinutes: 5,
};

let settings = loadSettings();
let notificationHistory = loadHistory();

// Track which sessions have already triggered idle threshold alert
const idleAlerted = new Set();

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved), conditions: { ...DEFAULT_SETTINGS.conditions, ...JSON.parse(saved).conditions } };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS, conditions: { ...DEFAULT_SETTINGS.conditions } };
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(notificationHistory));
}

export function getSettings() { return settings; }
export function getHistory() { return notificationHistory; }

export function updateSettings(updates) {
  if (updates.conditions) {
    settings.conditions = { ...settings.conditions, ...updates.conditions };
    delete updates.conditions;
  }
  Object.assign(settings, updates);
  saveSettings();
}

export function clearHistory() {
  notificationHistory = [];
  saveHistory();
  renderNotificationHistory();
}

// --- Sound ---

let audioCtx = null;
function playAlertSound() {
  if (!settings.sound) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch { /* ignore */ }
}

// --- Core: Check & Send Notification ---

const CONDITION_LABELS = {
  waiting_input: '입력 대기',
  waiting_permission: '권한 요청',
  disconnected: '연결 끊김',
  ended: '세션 종료',
  idle_threshold: 'idle 임계 초과',
};

function addToHistory(session, condition) {
  const entry = {
    id: Date.now(),
    sessionId: session.sessionId,
    projectName: session.projectName,
    condition,
    label: CONDITION_LABELS[condition] || condition,
    body: session.lastResponse ? truncate(session.lastResponse, 80) : '',
    ts: new Date().toISOString(),
    read: false,
  };
  notificationHistory.unshift(entry);
  if (notificationHistory.length > MAX_HISTORY) notificationHistory.pop();
  saveHistory();
  renderNotificationHistory();
  updateNotificationBadge();
}

function sendNotification(session, condition) {
  if (!settings.enabled || !settings.conditions[condition]) return;

  addToHistory(session, condition);
  playAlertSound();

  // Desktop notification (only when not focused)
  if (!state.notificationsEnabled || document.hasFocus()) return;
  const label = CONDITION_LABELS[condition] || condition;
  const n = new Notification(`${session.projectName} — ${label}`, {
    body: session.lastResponse ? truncate(session.lastResponse, 100) : '',
    tag: `${session.sessionId}-${condition}`,
  });
  setTimeout(() => n.close(), 8000);
}

// --- SSE Integration: Called from sse.js ---

export function checkSessionTransition(prev, updated) {
  if (!prev) return;

  // waiting_input: active → waiting_input
  if (prev.status === 'active' && updated.status === 'waiting_input') {
    sendNotification(updated, 'waiting_input');
    return;
  }

  // waiting_permission: any → waiting_permission
  if (prev.status !== 'waiting_permission' && updated.status === 'waiting_permission') {
    sendNotification(updated, 'waiting_permission');
    return;
  }

  // disconnected: non-disconnected → disconnected
  if (prev.status !== 'disconnected' && updated.status === 'disconnected') {
    sendNotification(updated, 'disconnected');
    return;
  }

  // ended: non-ended → ended
  if (prev.status !== 'ended' && updated.status === 'ended') {
    sendNotification(updated, 'ended');
    return;
  }
}

// --- Idle Threshold Check (called every second from sse.js timer) ---

export function checkIdleThreshold() {
  if (!settings.enabled || !settings.conditions.idle_threshold) return;

  const thresholdMs = settings.idleMinutes * 60 * 1000;
  const now = Date.now();

  for (const session of state.sessions) {
    if (!session.idleSince) {
      idleAlerted.delete(session.sessionId);
      continue;
    }
    if (idleAlerted.has(session.sessionId)) continue;

    const idleMs = now - new Date(session.idleSince).getTime();
    if (idleMs >= thresholdMs) {
      idleAlerted.add(session.sessionId);
      sendNotification(session, 'idle_threshold');
    }
  }
}

// --- Notification Settings UI ---

export function renderNotificationSettings() {
  const panel = document.getElementById('notification-settings');
  if (!panel) return;

  panel.innerHTML = `
    <div class="notif-setting-row">
      <label><input type="checkbox" id="notif-enabled" ${settings.enabled ? 'checked' : ''} /> 알림 활성화</label>
    </div>
    <div class="notif-setting-row">
      <label><input type="checkbox" id="notif-sound" ${settings.sound ? 'checked' : ''} /> 효과음</label>
    </div>
    <div class="notif-divider"></div>
    <div class="notif-setting-label">알림 조건</div>
    <div class="notif-setting-row">
      <label><input type="checkbox" data-cond="waiting_input" ${settings.conditions.waiting_input ? 'checked' : ''} /> 입력 대기 (waiting_input)</label>
    </div>
    <div class="notif-setting-row">
      <label><input type="checkbox" data-cond="waiting_permission" ${settings.conditions.waiting_permission ? 'checked' : ''} /> 권한 요청 (waiting_permission)</label>
    </div>
    <div class="notif-setting-row">
      <label><input type="checkbox" data-cond="disconnected" ${settings.conditions.disconnected ? 'checked' : ''} /> 연결 끊김 (disconnected)</label>
    </div>
    <div class="notif-setting-row">
      <label><input type="checkbox" data-cond="ended" ${settings.conditions.ended ? 'checked' : ''} /> 세션 종료 (ended)</label>
    </div>
    <div class="notif-divider"></div>
    <div class="notif-setting-row">
      <label><input type="checkbox" data-cond="idle_threshold" ${settings.conditions.idle_threshold ? 'checked' : ''} /> idle 임계 초과</label>
      <div class="notif-idle-input">
        <input type="number" id="notif-idle-minutes" value="${settings.idleMinutes}" min="1" max="60" /> 분
      </div>
    </div>
  `;

  // Event listeners
  panel.querySelector('#notif-enabled').addEventListener('change', (e) => {
    updateSettings({ enabled: e.target.checked });
  });
  panel.querySelector('#notif-sound').addEventListener('change', (e) => {
    updateSettings({ sound: e.target.checked });
    if (e.target.checked) playAlertSound(); // preview
  });
  panel.querySelectorAll('[data-cond]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      updateSettings({ conditions: { [e.target.dataset.cond]: e.target.checked } });
    });
  });
  panel.querySelector('#notif-idle-minutes').addEventListener('change', (e) => {
    const val = Math.max(1, Math.min(60, Number(e.target.value) || 5));
    updateSettings({ idleMinutes: val });
    idleAlerted.clear(); // re-check with new threshold
  });
}

// --- Notification History Panel ---

export function renderNotificationHistory() {
  const list = document.getElementById('notification-history-list');
  if (!list) return;

  if (notificationHistory.length === 0) {
    list.innerHTML = '<p class="empty-state" style="padding:12px 0;font-size:12px">알림 없음</p>';
    return;
  }

  list.innerHTML = notificationHistory.map(entry => {
    const time = new Date(entry.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="notif-history-item${entry.read ? '' : ' unread'}" data-notif-id="${entry.id}">
        <div class="notif-history-header">
          <span class="notif-history-name">${entry.projectName}</span>
          <span class="notif-history-time">${time}</span>
        </div>
        <div class="notif-history-label">${entry.label}</div>
        ${entry.body ? `<div class="notif-history-body">${entry.body}</div>` : ''}
      </div>
    `;
  }).join('');

  // Mark as read on click
  list.querySelectorAll('.notif-history-item.unread').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.notifId);
      const entry = notificationHistory.find(e => e.id === id);
      if (entry) { entry.read = true; saveHistory(); }
      el.classList.remove('unread');
      updateNotificationBadge();
    });
  });
}

export function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const unread = notificationHistory.filter(e => !e.read).length;
  badge.textContent = unread > 0 ? unread : '';
  badge.hidden = unread === 0;
}
