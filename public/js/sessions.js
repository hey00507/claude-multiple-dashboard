import { state, STATUS_ICONS, STATUS_ORDER, ACTIVE_STATUSES } from './state.js';
import { formatDuration, htmlEscape, truncate } from './utils.js';

const sessionsEl = document.getElementById('sessions');
const sessionCountEl = document.getElementById('session-count');

export function getProjectName(sessionId) {
  const s = state.sessions.find(s => s.sessionId === sessionId);
  return s ? s.projectName : sessionId.slice(0, 8);
}

export function getSessionStatus(sessionId) {
  const s = state.sessions.find(s => s.sessionId === sessionId);
  return s ? s.status : 'ended';
}

export function sortSessions(list) {
  return list.sort((a, b) => {
    // Pinned sessions first
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const orderDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

function groupSessionsByCwd(sessionList) {
  const groups = new Map();
  for (const s of sessionList) {
    if (!groups.has(s.cwd)) groups.set(s.cwd, []);
    groups.get(s.cwd).push(s);
  }
  return groups;
}

function sortGroups(groups) {
  return [...groups.entries()].sort((a, b) => {
    const aHasActive = a[1].some(s => ACTIVE_STATUSES.includes(s.status));
    const bHasActive = b[1].some(s => ACTIVE_STATUSES.includes(s.status));
    if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
    const aLatest = Math.max(...a[1].map(s => new Date(s.lastActivityAt).getTime()));
    const bLatest = Math.max(...b[1].map(s => new Date(s.lastActivityAt).getTime()));
    return bLatest - aLatest;
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

  const selected = s.sessionId === state.selectedSessionId ? ' selected' : '';

  // Model & context info
  const modelName = s.model ? s.model.replace('claude-', '').replace(/-/g, ' ') : '';
  const ctxPercent = (s.contextTokens && s.maxContextTokens) ? Math.round(s.contextTokens / s.maxContextTokens * 100) : null;
  const ctxLabel = s.maxContextTokens ? `${Math.round(s.maxContextTokens / 1000)}K` : '';
  const elapsed = formatDuration(Date.now() - new Date(s.startedAt).getTime());

  let metaParts = [];
  if (modelName) metaParts.push(modelName);
  if (ctxLabel) metaParts.push(ctxLabel);
  if (ctxPercent !== null) metaParts.push(`ctx: ${ctxPercent}%`);
  metaParts.push(`⏱ ${elapsed}`);
  const metaHtml = `<div class="session-meta" data-started="${s.startedAt}">${metaParts.join(' · ')}</div>`;

  const sourceBadge = s.source === 'pty' ? '<span class="badge badge-pty">PTY</span>' : '';

  return `
    <div class="session-card${selected}" data-session-id="${s.sessionId}">
      <div class="top-row">
        <span class="project-name">
          <span class="status-dot ${s.status}"></span>${icon}
          <span class="project-name-text" data-session-id="${s.sessionId}">${htmlEscape(s.projectName)}</span>
          ${sourceBadge}
          <button class="btn-pin" data-session-id="${s.sessionId}" title="${s.pinned ? '핀 해제' : '핀 고정'}">${s.pinned ? '📌' : '📍'}</button>
          <button class="btn-rename" data-session-id="${s.sessionId}" title="이름 변경">✏️</button>
        </span>
        ${idleHtml}
      </div>
      ${metaHtml}
      <div class="cwd">${s.cwd.replace(/^\/Users\/[^/]+/, '~')}</div>
      <div class="last-activity">${activity}${viewBtn}</div>
    </div>
  `;
}

function renderGroupedCards(sessionList) {
  const groups = sortGroups(groupSessionsByCwd(sessionList));
  if (groups.length === 1) return sessionList.map(renderSessionCard).join('');

  return groups.map(([cwd, groupSessions]) => {
    const cwdShort = cwd.replace(/^\/Users\/[^/]+/, '~');
    return `
      <div class="session-group">
        <div class="session-group-header">
          <span class="group-path">${htmlEscape(cwdShort)}</span>
          <span class="group-count">${groupSessions.length}개</span>
        </div>
        ${sortSessions([...groupSessions]).map(renderSessionCard).join('')}
      </div>
    `;
  }).join('');
}

function renderInactiveGroupedCards(sessionList) {
  const groups = sortGroups(groupSessionsByCwd(sessionList));
  if (groups.length <= 1) return sessionList.map(renderSessionCard).join('');

  return groups.map(([cwd, groupSessions]) => {
    const cwdShort = cwd.replace(/^\/Users\/[^/]+/, '~');
    return `
      <div class="session-group inactive">
        <div class="session-group-header">
          <span class="group-path">${htmlEscape(cwdShort)}</span>
          <span class="group-count">${groupSessions.length}개</span>
        </div>
        ${sortSessions([...groupSessions]).map(renderSessionCard).join('')}
      </div>
    `;
  }).join('');
}

export function renderSessions() {
  const active = state.sessions.filter(s => ACTIVE_STATUSES.includes(s.status));
  sessionCountEl.textContent = active.length > 0 ? `${active.length}개 활성 세션` : '';

  if (state.sessions.length === 0) {
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

  const sorted = sortSessions([...state.sessions]);
  const activeSessions = sorted.filter(s => ACTIVE_STATUSES.includes(s.status));
  const inactiveSessions = sorted.filter(s => !ACTIVE_STATUSES.includes(s.status));

  let html = '';

  if (activeSessions.length > 0) {
    html += renderGroupedCards(activeSessions);
  } else {
    html += '<p class="empty-state" style="padding:16px 0">활성 세션 없음</p>';
  }

  if (inactiveSessions.length > 0) {
    const openAttr = state.inactiveSessionsOpen ? ' open' : '';
    html += `
      <details class="inactive-sessions-group"${openAttr}>
        <summary class="inactive-sessions-toggle">
          종료/비활성 세션 (${inactiveSessions.length}개)
        </summary>
        <div class="inactive-sessions-actions">
          <button class="btn-bulk-delete" id="btn-bulk-delete">모두 삭제</button>
        </div>
        <div class="inactive-sessions-list">
          ${renderInactiveGroupedCards(inactiveSessions)}
        </div>
      </details>
    `;
  }

  sessionsEl.innerHTML = html;

  const details = sessionsEl.querySelector('.inactive-sessions-group');
  if (details) {
    details.addEventListener('toggle', () => {
      state.inactiveSessionsOpen = details.open;
    });
  }
}
