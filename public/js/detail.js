import { state, STATUS_ICONS, ACTIVE_STATUSES } from './state.js';
import { htmlEscape, truncate } from './utils.js';
import { renderSessions } from './sessions.js';
import { fetchHistory, fetchStats } from './history.js';

const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailTimeline = document.getElementById('detail-timeline');

export async function openDetail(sessionId) {
  state.selectedSessionId = sessionId;
  const session = state.sessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  document.querySelectorAll('.session-card').forEach(el => el.classList.remove('selected'));
  const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
  if (card) card.classList.add('selected');

  const res = await fetch(`/api/logs?sessionId=${sessionId}&limit=200`);
  const logs = await res.json();

  renderDetail(session, logs);
  detailPanel.removeAttribute('hidden');
}

export function closeDetail() {
  state.selectedSessionId = null;
  detailPanel.setAttribute('hidden', '');
  detailPanel.classList.remove('fullview');
  document.querySelectorAll('.session-card').forEach(el => el.classList.remove('selected'));
}

function renderDetail(session, logs) {
  const icon = STATUS_ICONS[session.status] || '❓';
  detailTitle.textContent = `${icon} ${session.projectName}`;

  const isActive = ACTIVE_STATUSES.includes(session.status);
  document.getElementById('detail-kill').style.display = isActive ? '' : 'none';
  document.getElementById('detail-delete').style.display = isActive ? 'none' : '';

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

// --- Session Actions ---

export async function deleteSessionFromPanel(sessionId) {
  if (!confirm('이 세션을 삭제하시겠습니까?')) return;
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (res.ok) {
    state.sessions = state.sessions.filter(s => s.sessionId !== sessionId);
    renderSessions();
    closeDetail();
    fetchHistory();
    fetchStats();
  } else {
    const err = await res.json();
    alert(err.error || '삭제 실패');
  }
}

export async function killSession(sessionId) {
  if (!confirm('이 세션을 종료하시겠습니까?')) return;
  const res = await fetch(`/api/sessions/${sessionId}/kill`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || '종료 실패');
  }
}

export async function launchSession() {
  const cwd = prompt('Claude Code를 실행할 프로젝트 경로를 입력하세요:', '~/');
  if (!cwd || !cwd.trim()) return;

  const res = await fetch('/api/sessions/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: cwd.trim() }),
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || '실행 실패');
  }
}

export async function renameSession(sessionId) {
  const session = state.sessions.find(s => s.sessionId === sessionId);
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
    const idx = state.sessions.findIndex(s => s.sessionId === sessionId);
    if (idx >= 0) state.sessions[idx] = updated;
    renderSessions();
  }
}

export async function deleteAllInactiveSessions() {
  if (!confirm('종료/비활성 세션과 관련 로그를 모두 삭제하시겠습니까?')) return;
  const res = await fetch('/api/sessions', { method: 'DELETE' });
  if (res.ok) {
    state.sessions = state.sessions.filter(s => ACTIVE_STATUSES.includes(s.status));
    renderSessions();
    fetchHistory();
    fetchStats();
  } else {
    const err = await res.json();
    alert(err.error || '삭제 실패');
  }
}

// --- Modal ---

export function showModal(title, text) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = text;
  document.getElementById('modal-overlay').classList.add('active');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}
