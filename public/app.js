const sessionsEl = document.getElementById('sessions');
const historyEl = document.getElementById('history-list');
const historyTitle = document.getElementById('history-title');
const dateSelect = document.getElementById('date-filter-history');
const loadMoreBtn = document.getElementById('load-more');
const historyFooter = document.getElementById('history-footer');
const sessionCountEl = document.getElementById('session-count');
const eventFiltersEl = document.getElementById('event-filters');
const projectFilterEl = document.getElementById('project-filter');
const searchInput = document.getElementById('search-input');

const STATUS_ICONS = {
  active: '🟢',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  ended: '⚪',
  disconnected: '🔴',
};

const STATUS_ORDER = {
  active: 0,
  waiting_permission: 1,
  waiting_input: 2,
  disconnected: 3,
  ended: 4,
};

let sessions = [];
let historyLogs = [];
let historyDate = todayStr();
let historyOffset = 0;
const PAGE_SIZE = 50;
let historyHasMore = false;
let selectedSessionId = null;
let activeEventFilter = 'all';
let activeProjectFilter = 'all';
let searchQuery = '';
let notificationsEnabled = false;
let inactiveSessionsOpen = false;

const btnExportJson = document.getElementById('btn-export-json');
const btnExportCsv = document.getElementById('btn-export-csv');

const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailTimeline = document.getElementById('detail-timeline');
const detailClose = document.getElementById('detail-close');
const detailDelete = document.getElementById('detail-delete');
const detailKill = document.getElementById('detail-kill');
const btnNewSession = document.getElementById('btn-new-session');

// --- Date Utils ---

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatDateLabel(dateStr) {
  const today = todayStr();
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = d.toLocaleDateString('ko-KR', { weekday: 'short' });
  const label = `${d.getMonth() + 1}/${d.getDate()} (${weekday})`;
  return dateStr === today ? `오늘 — ${label}` : label;
}

function initDateSelector() {
  const today = new Date();
  dateSelect.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const val = d.toISOString().split('T')[0];
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = formatDateLabel(val);
    dateSelect.appendChild(opt);
  }
  dateSelect.value = historyDate;
}

// --- Fetch & Render ---

async function fetchSessions() {
  sessionsEl.innerHTML = '<p class="loading-state">세션 로딩 중...</p>';
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sessions = await res.json();
    renderSessions();
  } catch (err) {
    sessionsEl.innerHTML = `<p class="error-state">세션 로딩 실패: ${err.message}</p>`;
  }
}

async function fetchHistory(append = false) {
  if (!append) {
    historyOffset = 0;
    historyLogs = [];
    historyEl.innerHTML = '<p class="loading-state">로딩 중...</p>';
  }

  try {
    const res = await fetch(`/api/logs?date=${historyDate}&limit=${PAGE_SIZE}&offset=${historyOffset}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const logs = await res.json();

    if (append) {
      historyLogs = historyLogs.concat(logs);
    } else {
      historyLogs = logs;
    }

    historyHasMore = logs.length >= PAGE_SIZE;
    historyFooter.hidden = !historyHasMore;
    updateProjectFilter();
    renderHistory();
    updateHistoryTitle();
  } catch (err) {
    historyEl.innerHTML = `<p class="error-state">히스토리 로딩 실패: ${err.message}</p>`;
    historyFooter.hidden = true;
  }
}

function updateHistoryTitle() {
  const isToday = historyDate === todayStr();
  historyTitle.textContent = isToday ? '오늘의 활동' : `${formatDateLabel(historyDate)} 활동`;
}

function getProjectName(sessionId) {
  const s = sessions.find(s => s.sessionId === sessionId);
  return s ? s.projectName : sessionId.slice(0, 8);
}

function getSessionStatus(sessionId) {
  const s = sessions.find(s => s.sessionId === sessionId);
  return s ? s.status : 'ended';
}

function sortSessions(list) {
  return list.sort((a, b) => {
    const orderDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

function renderSessionCard(s) {
  const icon = STATUS_ICONS[s.status] || '❓';
  const idleHtml = s.idleSince
    ? `<span class="idle-time" data-since="${s.idleSince}">⏱ idle ${formatDuration(Date.now() - new Date(s.idleSince).getTime())}</span>`
    : '';

  let activity = '';
  let viewBtn = '';
  if (s.status === 'active' && s.lastToolUsed) {
    activity = `Tool: ${s.lastToolUsed}`;
  } else if (s.status === 'waiting_input') {
    if (s.lastResponse) {
      activity = `🤖 "${truncate(s.lastResponse, 80)}"`;
      if (s.lastResponse.length > 80) {
        viewBtn = `<button class="btn-view" data-modal-title="🤖 Response" data-modal-text="${htmlEscape(s.lastResponse)}">view</button>`;
      }
    } else {
      activity = s.lastPrompt ? `💬 "${truncate(s.lastPrompt, 50)}"` : '응답 완료 — 입력 대기 중';
    }
  } else if (s.status === 'waiting_permission') {
    activity = '🔒 권한 승인 대기';
  } else if (s.status === 'ended') {
    activity = '세션 종료';
  } else if (s.status === 'disconnected') {
    activity = '연결 끊김';
  }

  const selected = s.sessionId === selectedSessionId ? ' selected' : '';

  return `
    <div class="session-card${selected}" data-session-id="${s.sessionId}">
      <div class="top-row">
        <span class="project-name">
          <span class="status-dot ${s.status}"></span>${icon}
          <span class="project-name-text" data-session-id="${s.sessionId}">${htmlEscape(s.projectName)}</span>
          <button class="btn-rename" data-session-id="${s.sessionId}" title="이름 변경">✏️</button>
        </span>
        ${idleHtml}
      </div>
      <div class="cwd">${s.cwd.replace(/^\/Users\/[^/]+/, '~')}</div>
      <div class="last-activity">${activity}${viewBtn}</div>
    </div>
  `;
}

function groupSessionsByCwd(sessionList) {
  const groups = new Map();
  for (const s of sessionList) {
    const key = s.cwd;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return groups;
}

function sortGroups(groups) {
  const ACTIVE_STATUSES = ['active', 'waiting_input', 'waiting_permission'];
  return [...groups.entries()].sort((a, b) => {
    const aHasActive = a[1].some(s => ACTIVE_STATUSES.includes(s.status));
    const bHasActive = b[1].some(s => ACTIVE_STATUSES.includes(s.status));
    if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
    const aLatest = Math.max(...a[1].map(s => new Date(s.lastActivityAt).getTime()));
    const bLatest = Math.max(...b[1].map(s => new Date(s.lastActivityAt).getTime()));
    return bLatest - aLatest;
  });
}

function renderSessions() {
  const ACTIVE_STATUSES = ['active', 'waiting_input', 'waiting_permission'];

  // Update header count
  const active = sessions.filter(s => ACTIVE_STATUSES.includes(s.status));
  sessionCountEl.textContent = active.length > 0 ? `${active.length}개 활성 세션` : '';

  if (sessions.length === 0) {
    sessionsEl.innerHTML = `
      <div class="empty-state">
        <p>등록된 세션이 없습니다</p>
        <div class="guide">
          처음이라면 먼저 hook을 등록하세요:<br>
          <code>claude-dash init</code><br><br>
          그 다음 Claude Code를 실행하면 자동으로 세션이 추적됩니다.
        </div>
      </div>`;
    return;
  }

  const sorted = sortSessions([...sessions]);
  const activeSessions = sorted.filter(s => ACTIVE_STATUSES.includes(s.status));
  const inactiveSessions = sorted.filter(s => !ACTIVE_STATUSES.includes(s.status));

  let html = '';

  // Active sessions — grouped by project directory
  if (activeSessions.length > 0) {
    const activeGroups = sortGroups(groupSessionsByCwd(activeSessions));

    if (activeGroups.length === 1 && activeGroups[0][1].length === activeSessions.length) {
      // Single group — no need for grouping UI
      html += activeSessions.map(renderSessionCard).join('');
    } else {
      for (const [cwd, groupSessions] of activeGroups) {
        const cwdShort = cwd.replace(/^\/Users\/[^/]+/, '~');
        html += `
          <div class="session-group">
            <div class="session-group-header">
              <span class="group-path">${htmlEscape(cwdShort)}</span>
              <span class="group-count">${groupSessions.length}개</span>
            </div>
            ${sortSessions([...groupSessions]).map(renderSessionCard).join('')}
          </div>
        `;
      }
    }
  } else {
    html += '<p class="empty-state" style="padding:16px 0">활성 세션 없음</p>';
  }

  // Inactive sessions — collapsible, grouped by project
  if (inactiveSessions.length > 0) {
    const openAttr = inactiveSessionsOpen ? ' open' : '';
    const inactiveGroups = sortGroups(groupSessionsByCwd(inactiveSessions));

    let inactiveHtml = '';
    if (inactiveGroups.length <= 1) {
      inactiveHtml = inactiveSessions.map(renderSessionCard).join('');
    } else {
      for (const [cwd, groupSessions] of inactiveGroups) {
        const cwdShort = cwd.replace(/^\/Users\/[^/]+/, '~');
        inactiveHtml += `
          <div class="session-group inactive">
            <div class="session-group-header">
              <span class="group-path">${htmlEscape(cwdShort)}</span>
              <span class="group-count">${groupSessions.length}개</span>
            </div>
            ${sortSessions([...groupSessions]).map(renderSessionCard).join('')}
          </div>
        `;
      }
    }

    html += `
      <details class="inactive-sessions-group"${openAttr}>
        <summary class="inactive-sessions-toggle">
          종료/비활성 세션 (${inactiveSessions.length}개)
        </summary>
        <div class="inactive-sessions-actions">
          <button class="btn-bulk-delete" id="btn-bulk-delete">모두 삭제</button>
        </div>
        <div class="inactive-sessions-list">
          ${inactiveHtml}
        </div>
      </details>
    `;
  }

  sessionsEl.innerHTML = html;

  // Persist toggle state
  const details = sessionsEl.querySelector('.inactive-sessions-group');
  if (details) {
    details.addEventListener('toggle', () => {
      inactiveSessionsOpen = details.open;
    });
  }
}

function matchesEventFilter(log) {
  if (activeEventFilter === 'all') return true;
  if (activeEventFilter === 'prompt') return !!log.prompt;
  if (activeEventFilter === 'response') return !!log.response;
  if (activeEventFilter === 'tool') return !!log.tool;
  if (activeEventFilter === 'session') return log.event === 'SessionStart' || log.event === 'SessionEnd';
  return true;
}

function matchesProjectFilter(log) {
  if (activeProjectFilter === 'all') return true;
  return log.sessionId === activeProjectFilter;
}

function matchesSearch(log) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  if (log.prompt && log.prompt.toLowerCase().includes(q)) return true;
  if (log.response && log.response.toLowerCase().includes(q)) return true;
  if (log.tool && log.tool.toLowerCase().includes(q)) return true;
  if (log.input?.file_path && log.input.file_path.toLowerCase().includes(q)) return true;
  if (log.input?.command && log.input.command.toLowerCase().includes(q)) return true;
  return false;
}

function getFilteredLogs() {
  return historyLogs.filter(log => matchesEventFilter(log) && matchesProjectFilter(log) && matchesSearch(log));
}

function updateProjectFilter() {
  const prev = projectFilterEl.value;
  const sessionIds = [...new Set(historyLogs.map(l => l.sessionId))];

  projectFilterEl.innerHTML = '<option value="all">모든 프로젝트</option>';
  for (const id of sessionIds) {
    const name = getProjectName(id);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    projectFilterEl.appendChild(opt);
  }

  // Restore previous selection if still valid
  if (sessionIds.includes(prev)) {
    projectFilterEl.value = prev;
    activeProjectFilter = prev;
  } else {
    activeProjectFilter = 'all';
  }
}

function renderHistory() {
  const filtered = getFilteredLogs();

  if (historyLogs.length === 0) {
    const isToday = historyDate === todayStr();
    historyEl.innerHTML = `<p class="empty-state">${isToday ? '오늘 기록이 없습니다' : '해당 날짜의 기록이 없습니다'}</p>`;
    return;
  }

  if (filtered.length === 0) {
    historyEl.innerHTML = '<p class="empty-state">필터 조건에 맞는 기록이 없습니다</p>';
    return;
  }

  historyEl.innerHTML = filtered.map(log => {
    const time = new Date(log.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const projectName = getProjectName(log.sessionId);
    const status = getSessionStatus(log.sessionId);
    const icon = STATUS_ICONS[status] || '❓';
    let detail = log.event;
    let fullText = null;
    if (log.tool) detail = `${log.tool} ${log.input?.file_path || log.input?.command || ''}`;
    if (log.prompt) { detail = `💬 "${truncate(log.prompt, 40)}"`; if (log.prompt.length > 40) fullText = log.prompt; }
    if (log.response) { detail = `🤖 "${truncate(log.response, 40)}"`; if (log.response.length > 40) fullText = log.response; }
    const viewBtn = fullText ? `<button class="btn-view" data-modal-title="${log.response ? '🤖 Response' : '💬 Prompt'}" data-modal-text="${htmlEscape(fullText)}">view</button>` : '';

    return `
      <div class="history-item">
        <span class="time">${time}</span>
        <span class="project">${icon} ${htmlEscape(projectName)}</span>
        <span class="detail">${detail}${viewBtn}</span>
      </div>
    `;
  }).join('');
}

// --- Detail Panel ---

async function openDetail(sessionId) {
  selectedSessionId = sessionId;
  const session = sessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  // Highlight selected card
  document.querySelectorAll('.session-card').forEach(el => el.classList.remove('selected'));
  const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
  if (card) card.classList.add('selected');

  // Fetch session logs
  const res = await fetch(`/api/logs?sessionId=${sessionId}&limit=200`);
  const logs = await res.json();

  renderDetail(session, logs);
  detailPanel.removeAttribute('hidden');
}

function closeDetail() {
  selectedSessionId = null;
  detailPanel.setAttribute('hidden', '');
  detailPanel.classList.remove('fullview');
  document.querySelectorAll('.session-card').forEach(el => el.classList.remove('selected'));
}

function renderDetail(session, logs) {
  const icon = STATUS_ICONS[session.status] || '❓';
  detailTitle.textContent = `${icon} ${session.projectName}`;

  // Show/hide kill button (only for active sessions) and delete button (only for non-active)
  const isActive = session.status === 'active' || session.status === 'waiting_input' || session.status === 'waiting_permission';
  detailKill.style.display = isActive ? '' : 'none';
  detailDelete.style.display = isActive ? 'none' : '';

  // Meta info
  const started = new Date(session.startedAt).toLocaleString('ko-KR');
  const lastActivity = new Date(session.lastActivityAt).toLocaleString('ko-KR');
  const ended = session.endedAt ? new Date(session.endedAt).toLocaleString('ko-KR') : null;

  detailMeta.innerHTML = `
    <div class="meta-item"><span class="meta-label">상태</span><span class="meta-value"><span class="status-dot ${session.status}"></span>${session.status}</span></div>
    <div class="meta-item"><span class="meta-label">디렉토리</span><span class="meta-value">${session.cwd.replace(/^\/Users\/[^/]+/, '~')}</span></div>
    <div class="meta-item"><span class="meta-label">시작</span><span class="meta-value">${started}</span></div>
    <div class="meta-item"><span class="meta-label">마지막 활동</span><span class="meta-value">${lastActivity}</span></div>
    ${ended ? `<div class="meta-item"><span class="meta-label">종료</span><span class="meta-value">${ended}</span></div>` : ''}
    <div class="meta-item"><span class="meta-label">총 이벤트</span><span class="meta-value">${session.totalEvents}</span></div>
  `;

  // Timeline
  if (logs.length === 0) {
    detailTimeline.innerHTML = '<p class="empty-state" style="padding:24px 0">타임라인 기록 없음</p>';
    return;
  }

  detailTimeline.innerHTML = logs.map(log => {
    const time = new Date(log.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let event = log.event;
    let detail = '';

    if (log.tool) {
      event = `🔧 ${log.tool}`;
      const input = log.input;
      if (input?.file_path) detail = input.file_path.replace(/^\/Users\/[^/]+/, '~');
      else if (input?.command) detail = truncate(input.command, 60);
      else if (input?.pattern) detail = input.pattern;
    } else if (log.prompt) {
      event = '💬 Prompt';
      detail = log.prompt;
    } else if (log.response) {
      event = '🤖 Response';
      detail = log.response;
    } else if (log.event === 'SessionStart') {
      event = '▶️ 세션 시작';
    } else if (log.event === 'SessionEnd') {
      event = '⏹ 세션 종료';
    } else if (log.event === 'Stop') {
      event = '⏸ 응답 완료';
    } else if (log.event === 'Notification') {
      event = '🔔 알림';
    }

    const isLong = detail.length > 300;
    const displayDetail = isLong ? truncate(detail, 300) : detail;

    return `
      <div class="timeline-item">
        <div class="tl-time">${time}</div>
        <div class="tl-event">${event}</div>
        ${detail ? `<div class="tl-detail">${htmlEscape(displayDetail)}</div>` : ''}
        ${isLong ? `<div class="tl-actions"><button class="btn-view" data-modal-title="${htmlEscape(event)}" data-modal-text="${htmlEscape(detail)}">view full</button></div>` : ''}
      </div>
    `;
  }).join('');
}

async function deleteSessionFromPanel(sessionId) {
  if (!confirm('이 세션을 삭제하시겠습니까?')) return;
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (res.ok) {
    sessions = sessions.filter(s => s.sessionId !== sessionId);
    renderSessions();
    closeDetail();
  } else {
    const err = await res.json();
    alert(err.error || '삭제 실패');
  }
}

async function killSession(sessionId) {
  if (!confirm('이 세션을 종료하시겠습니까?')) return;
  const res = await fetch(`/api/sessions/${sessionId}/kill`, { method: 'POST' });
  if (res.ok) {
    const result = await res.json();
    // Session will be updated via SSE
  } else {
    const err = await res.json();
    alert(err.error || '종료 실패');
  }
}

async function launchSession() {
  const cwd = prompt('Claude Code를 실행할 프로젝트 경로를 입력하세요:', '~/');
  if (!cwd || !cwd.trim()) return;

  // Expand ~ to home dir on the server side
  const expandedCwd = cwd.trim();

  const res = await fetch('/api/sessions/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: expandedCwd }),
  });

  if (res.ok) {
    // New session will appear via SSE when claude starts
  } else {
    const err = await res.json();
    alert(err.error || '실행 실패');
  }
}

// --- Export ---

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON() {
  const filtered = getFilteredLogs();
  if (filtered.length === 0) return;
  const json = JSON.stringify(filtered, null, 2);
  downloadFile(json, `claude-logs-${historyDate}.json`, 'application/json');
}

function exportCSV() {
  const filtered = getFilteredLogs();
  if (filtered.length === 0) return;
  const headers = ['timestamp', 'event', 'project', 'detail'];
  const rows = filtered.map(log => {
    const project = getProjectName(log.sessionId);
    let detail = log.event;
    if (log.tool) detail = `${log.tool} ${log.input?.file_path || log.input?.command || ''}`;
    if (log.prompt) detail = log.prompt;
    if (log.response) detail = log.response;
    return [log.ts, log.event, project, detail].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  downloadFile([headers.join(','), ...rows].join('\n'), `claude-logs-${historyDate}.csv`, 'text/csv');
}

// --- Bulk Delete ---

async function deleteAllInactiveSessions() {
  if (!confirm('종료/비활성 세션과 관련 로그를 모두 삭제하시겠습니까?')) return;
  const res = await fetch('/api/sessions', { method: 'DELETE' });
  if (res.ok) {
    const result = await res.json();
    sessions = sessions.filter(s => s.status === 'active' || s.status === 'waiting_input' || s.status === 'waiting_permission');
    renderSessions();
    fetchHistory();
  } else {
    const err = await res.json();
    alert(err.error || '삭제 실패');
  }
}

// --- Rename ---

async function renameSession(sessionId) {
  const session = sessions.find(s => s.sessionId === sessionId);
  if (!session) return;
  const newName = prompt('세션 이름 변경', session.projectName);
  if (!newName || newName.trim() === session.projectName) return;

  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName: newName.trim() }),
  });

  if (res.ok) {
    const updated = await res.json();
    const idx = sessions.findIndex(s => s.sessionId === sessionId);
    if (idx >= 0) sessions[idx] = updated;
    renderSessions();
    renderHistory();
  }
}

// --- SSE ---

function connectSSE() {
  const source = new EventSource('/api/events/stream');

  source.addEventListener('session_update', (e) => {
    const updated = JSON.parse(e.data);
    const idx = sessions.findIndex(s => s.sessionId === updated.sessionId);
    const prev = idx >= 0 ? sessions[idx] : null;

    // Send desktop notification when transitioning to waiting
    if (prev && prev.status === 'active' && (updated.status === 'waiting_input' || updated.status === 'waiting_permission')) {
      sendIdleNotification(updated);
    }

    if (idx >= 0) {
      sessions[idx] = updated;
    } else {
      sessions.unshift(updated);
    }
    renderSessions();
    updateTabTitle();

    // Refresh detail panel if showing this session
    if (selectedSessionId === updated.sessionId) {
      openDetail(updated.sessionId);
    }
  });

  source.addEventListener('log_update', (e) => {
    const log = JSON.parse(e.data);

    // Only add to history if viewing today
    if (historyDate === todayStr()) {
      historyLogs.unshift(log);
      if (historyLogs.length > PAGE_SIZE) historyLogs.pop();
      updateProjectFilter();
      renderHistory();
    }

    // Refresh detail timeline if showing this session
    if (selectedSessionId === log.sessionId) {
      openDetail(log.sessionId);
    }
  });

  source.onerror = () => {
    source.close();
    setTimeout(connectSSE, 3000);
  };
}

// --- Tab Title Badge ---

function updateTabTitle() {
  const waiting = sessions.filter(s => s.status === 'waiting_input' || s.status === 'waiting_permission');
  const base = 'Claude Dashboard';
  document.title = waiting.length > 0 ? `(${waiting.length}) ${base}` : base;
}

// --- Desktop Notifications ---

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => { notificationsEnabled = p === 'granted'; });
  } else {
    notificationsEnabled = Notification.permission === 'granted';
  }
}

function sendIdleNotification(session) {
  if (!notificationsEnabled || document.hasFocus()) return;
  const n = new Notification(`${session.projectName} — 입력 대기 중`, {
    body: session.lastResponse ? truncate(session.lastResponse, 100) : '응답 완료',
    tag: session.sessionId,
  });
  setTimeout(() => n.close(), 8000);
}

// --- Idle Timer ---

setInterval(() => {
  document.querySelectorAll('.idle-time[data-since]').forEach(el => {
    const since = new Date(el.dataset.since).getTime();
    el.textContent = `⏱ idle ${formatDuration(Date.now() - since)}`;
  });
  updateTabTitle();
}, 1000);

// --- Modal ---

window.showModal = function(title, text) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = text;
  document.getElementById('modal-overlay').classList.add('active');
};

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.remove('active');
};

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('keydown', (e) => {
  // Skip keyboard shortcuts when typing in search
  const isTyping = document.activeElement === searchInput;

  if (e.key === 'Escape') {
    if (isTyping) {
      searchInput.blur();
      return;
    }
    if (document.getElementById('modal-overlay').classList.contains('active')) {
      closeModal();
    } else if (selectedSessionId) {
      closeDetail();
    }
    return;
  }

  if (isTyping) return;

  // j/k: navigate sessions, Enter: open detail, /: focus search
  const sorted = sortSessions([...sessions]);
  if (!sorted.length) return;

  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault();
    const currentIdx = sorted.findIndex(s => s.sessionId === selectedSessionId);
    let nextIdx;
    if (e.key === 'j') {
      nextIdx = currentIdx < sorted.length - 1 ? currentIdx + 1 : 0;
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : sorted.length - 1;
    }
    openDetail(sorted[nextIdx].sessionId);
  } else if (e.key === 'Enter' && selectedSessionId) {
    e.preventDefault();
    detailPanel.classList.toggle('fullview');
  } else if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
  }
});

// --- Event Handlers ---

// Date selector change
dateSelect.addEventListener('change', () => {
  historyDate = dateSelect.value;
  fetchHistory();
});

// Event type filter chips
eventFiltersEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  activeEventFilter = chip.dataset.filter;
  eventFiltersEl.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderHistory();
});

// Project filter
projectFilterEl.addEventListener('change', () => {
  activeProjectFilter = projectFilterEl.value;
  renderHistory();
});

// Search input (debounced)
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = searchInput.value.trim();
    renderHistory();
  }, 200);
});

// Load more button
loadMoreBtn.addEventListener('click', () => {
  historyOffset += PAGE_SIZE;
  fetchHistory(true);
});

// Detail panel buttons
detailClose.addEventListener('click', closeDetail);
detailDelete.addEventListener('click', () => {
  if (selectedSessionId) deleteSessionFromPanel(selectedSessionId);
});
detailKill.addEventListener('click', () => {
  if (selectedSessionId) killSession(selectedSessionId);
});

// New session button
btnNewSession.addEventListener('click', launchSession);

// Export buttons
btnExportJson.addEventListener('click', exportJSON);
btnExportCsv.addEventListener('click', exportCSV);

document.addEventListener('click', (e) => {
  const bulkDeleteBtn = e.target.closest('.btn-bulk-delete');
  if (bulkDeleteBtn) {
    e.stopPropagation();
    deleteAllInactiveSessions();
    return;
  }

  const viewBtn = e.target.closest('.btn-view');
  if (viewBtn) {
    e.stopPropagation();
    showModal(viewBtn.dataset.modalTitle, viewBtn.dataset.modalText);
    return;
  }

  const renameBtn = e.target.closest('.btn-rename');
  if (renameBtn) {
    e.stopPropagation();
    renameSession(renameBtn.dataset.sessionId);
    return;
  }

  // Session card click → open detail panel
  const card = e.target.closest('.session-card');
  if (card) {
    openDetail(card.dataset.sessionId);
    return;
  }
});

// --- Utils ---

function formatDuration(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}:${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}`;
  }
  return `${mins}:${String(remainSecs).padStart(2, '0')}`;
}

function htmlEscape(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

// --- Theme ---

const btnTheme = document.getElementById('btn-theme');

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getCurrentTheme() {
  return localStorage.getItem('claude-dash-theme') || 'system';
}

function applyTheme() {
  const pref = getCurrentTheme();
  const effective = pref === 'system' ? getSystemTheme() : pref;
  if (pref === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', effective);
  }
  btnTheme.textContent = effective === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  btnTheme.title = pref === 'system' ? `테마: 시스템 (${effective})` : `테마: ${effective}`;
}

btnTheme.addEventListener('click', () => {
  const current = getCurrentTheme();
  const effective = current === 'system' ? getSystemTheme() : current;
  const next = effective === 'dark' ? 'light' : 'dark';
  localStorage.setItem('claude-dash-theme', next);
  applyTheme();
});

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (getCurrentTheme() === 'system') applyTheme();
});

applyTheme();

// --- Init ---

initDateSelector();
fetchSessions();
fetchHistory();
connectSSE();
requestNotificationPermission();
