const sessionsEl = document.getElementById('sessions');
const historyEl = document.getElementById('history-list');

const STATUS_ICONS = {
  active: '🟢',
  waiting_input: '🟡',
  waiting_permission: '🟠',
  ended: '⚪',
  disconnected: '🔴',
};

let sessions = [];
let historyLogs = [];
const MAX_HISTORY = 50;

// --- Fetch & Render ---

async function fetchSessions() {
  const res = await fetch('/api/sessions');
  sessions = await res.json();
  renderSessions();
}

async function fetchHistory() {
  const res = await fetch('/api/logs?limit=50');
  historyLogs = await res.json();
  renderHistory();
}

function getProjectName(sessionId) {
  const s = sessions.find(s => s.sessionId === sessionId);
  return s ? s.projectName : sessionId.slice(0, 8);
}

function getSessionStatus(sessionId) {
  const s = sessions.find(s => s.sessionId === sessionId);
  return s ? s.status : 'ended';
}

function renderSessions() {
  if (sessions.length === 0) {
    sessionsEl.innerHTML = '<p class="empty-state">활성 세션이 없습니다</p>';
    return;
  }

  sessionsEl.innerHTML = sessions.map(s => {
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

    return `
      <div class="session-card" data-session-id="${s.sessionId}">
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
  }).join('');
}

function renderHistory() {
  if (historyLogs.length === 0) {
    historyEl.innerHTML = '<p class="empty-state">오늘 기록이 없습니다</p>';
    return;
  }

  historyEl.innerHTML = historyLogs.map(log => {
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
    if (idx >= 0) {
      sessions[idx] = updated;
    } else {
      sessions.unshift(updated);
    }
    sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
    renderSessions();
  });

  source.addEventListener('log_update', (e) => {
    const log = JSON.parse(e.data);
    historyLogs.unshift(log);
    if (historyLogs.length > MAX_HISTORY) historyLogs.pop();
    renderHistory();
  });

  source.onerror = () => {
    source.close();
    setTimeout(connectSSE, 3000);
  };
}

// --- Idle Timer ---

setInterval(() => {
  document.querySelectorAll('.idle-time[data-since]').forEach(el => {
    const since = new Date(el.dataset.since).getTime();
    el.textContent = `⏱ idle ${formatDuration(Date.now() - since)}`;
  });
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
  if (e.key === 'Escape') closeModal();
});

document.addEventListener('click', (e) => {
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

// --- Init ---

fetchSessions();
fetchHistory();
connectSSE();
