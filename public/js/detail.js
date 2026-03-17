import { state, STATUS_ICONS, ACTIVE_STATUSES } from './state.js';
import { htmlEscape, truncate, downloadFile } from './utils.js';
import { renderSessions } from './sessions.js';
import { fetchHistory, fetchStats } from './history.js';
import { initTerminal, connectTerminal, disconnectTerminal, pauseTerminal, resumeTerminal, disposeTerminal, fitTerminal, getCurrentPtyId, updateTerminalTheme } from './terminal.js';
import { isGridVisible, showGrid, refreshGrid } from './terminal-grid.js';

const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailTimeline = document.getElementById('detail-timeline');
const detailTabs = document.getElementById('detail-tabs');
const tabTimeline = document.getElementById('tab-timeline');
const tabTerminal = document.getElementById('tab-terminal');
const terminalContainer = document.getElementById('terminal-container');

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

  // Determine PTY info
  let ptyId = session.ptyId || null;

  if (!ptyId && session.source === 'pty') {
    // Try fetching PTY info from API
    try {
      const ptyRes = await fetch(`/api/sessions/${sessionId}/pty`);
      if (ptyRes.ok) ptyId = (await ptyRes.json()).ptyId;
    } catch { /* ignore */ }
  }

  if (ptyId) {
    state.activePtyId = ptyId;
    enableTerminalTab();
    // If already connected to this PTY, just resume; otherwise connect
    if (getCurrentPtyId() === ptyId) {
      switchTab('terminal');
      resumeTerminal();
    } else {
      switchTab('terminal');
    }
  } else {
    state.activePtyId = null;
    disableTerminalTab();
    switchTab('timeline');
  }
}

export function closeDetail() {
  state.selectedSessionId = null;
  detailPanel.setAttribute('hidden', '');
  detailPanel.classList.remove('fullview');
  document.querySelectorAll('.session-card').forEach(el => el.classList.remove('selected'));
  // Pause WS but keep PTY alive — user can reconnect by clicking the session again
  pauseTerminal();
}

function enableTerminalTab() {
  const termTab = detailTabs.querySelector('[data-tab="terminal"]');
  if (termTab) {
    termTab.disabled = false;
    termTab.classList.remove('disabled');
  }
}

function disableTerminalTab() {
  const termTab = detailTabs.querySelector('[data-tab="terminal"]');
  if (termTab) {
    termTab.disabled = true;
    termTab.classList.add('disabled');
  }
}

export function switchTab(tabName) {
  state.activeTab = tabName;

  // Update tab buttons
  detailTabs.querySelectorAll('.detail-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Show/hide tab content
  tabTimeline.hidden = tabName !== 'timeline';
  tabTerminal.hidden = tabName !== 'terminal';

  if (tabName === 'terminal' && state.activePtyId) {
    if (!terminalContainer.querySelector('.xterm')) {
      initTerminal(terminalContainer);
    }
    connectTerminal(state.activePtyId);
    requestAnimationFrame(() => fitTerminal());
  } else if (tabName === 'timeline') {
    // Just pause WS when switching to timeline — don't kill the connection
    pauseTerminal();
  }
}

// Tab click handler
detailTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.detail-tab');
  if (!tab || tab.disabled) return;
  switchTab(tab.dataset.tab);
});

function renderDetail(session, logs) {
  const icon = STATUS_ICONS[session.status] || '?';
  detailTitle.textContent = `${icon} ${session.projectName}`;

  const isActive = ACTIVE_STATUSES.includes(session.status);
  document.getElementById('detail-kill').style.display = isActive ? '' : 'none';
  document.getElementById('detail-delete').style.display = isActive ? 'none' : '';

  const started = new Date(session.startedAt).toLocaleString('ko-KR');
  const lastActivity = new Date(session.lastActivityAt).toLocaleString('ko-KR');
  const ended = session.endedAt ? new Date(session.endedAt).toLocaleString('ko-KR') : null;

  const sourceLabel = session.source === 'pty' ? '<span class="badge badge-pty">PTY</span>' : '';

  detailMeta.innerHTML = `
    <div class="meta-item"><span class="meta-label">상태</span><span class="meta-value"><span class="status-dot ${session.status}"></span>${session.status} ${sourceLabel}</span></div>
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

// --- Launch Session (modal-based) ---

const launchOverlay = document.getElementById('launch-modal-overlay');
const launchCwdInput = document.getElementById('launch-cwd-input');
const terminalAppGroup = document.getElementById('terminal-app-group');
const terminalAppSelect = document.getElementById('launch-terminal-app');

// Toggle terminal app selector based on mode radio
document.querySelectorAll('input[name="launch-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="launch-mode"]:checked').value;
    terminalAppGroup.style.display = mode === 'terminal' ? '' : 'none';
  });
});

export function launchSession() {
  launchCwdInput.value = '~/';
  document.querySelector('input[name="launch-mode"][value="pty"]').checked = true;
  terminalAppGroup.style.display = 'none';
  launchOverlay.classList.add('active');
  setTimeout(() => {
    launchCwdInput.focus();
    launchCwdInput.select();
  }, 100);
}

export function closeLaunchModal() {
  launchOverlay.classList.remove('active');
}

async function doLaunch() {
  const cwd = launchCwdInput.value.trim();
  if (!cwd) return;

  const mode = document.querySelector('input[name="launch-mode"]:checked').value;
  const terminalApp = terminalAppSelect.value || undefined;

  closeLaunchModal();

  const body = { cwd, mode };
  if (mode === 'terminal' && terminalApp) body.terminalApp = terminalApp;

  const res = await fetch('/api/sessions/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = await res.json();

    if (data.mode === 'pty') {
      if (isGridVisible()) {
        // Grid view: just refresh grid to include new session
        // Small delay to let hook register the session
        setTimeout(() => refreshGrid(), 1500);
      } else {
        // Detail panel view: open terminal tab
        state.activePtyId = data.ptyId;

        detailTitle.textContent = `🟢 ${cwd.split('/').filter(Boolean).pop() || cwd}`;
        detailMeta.innerHTML = `
          <div class="meta-item"><span class="meta-label">디렉토리</span><span class="meta-value">${cwd.replace(/^\/Users\/[^/]+/, '~')}</span></div>
          <div class="meta-item"><span class="meta-label">상태</span><span class="meta-value"><span class="status-dot active"></span>시작 중... <span class="badge badge-pty">PTY</span></span></div>
        `;
        detailTimeline.innerHTML = '<p class="empty-state" style="padding:24px 0">세션 시작 중...</p>';

        detailPanel.removeAttribute('hidden');
        enableTerminalTab();
        switchTab('terminal');
      }
    }
    // terminal mode: external app opens, nothing more to do
  } else {
    const err = await res.json();
    alert(err.error || '실행 실패');
  }
}

// Launch modal events
document.getElementById('launch-modal-close').addEventListener('click', closeLaunchModal);
document.getElementById('launch-cancel-btn').addEventListener('click', closeLaunchModal);
document.getElementById('launch-start-btn').addEventListener('click', doLaunch);
launchCwdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLaunch();
  if (e.key === 'Escape') closeLaunchModal();
});
launchOverlay.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeLaunchModal();
});

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

// --- Transcript Export ---

export async function exportTranscript(sessionId) {
  const session = state.sessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  const res = await fetch(`/api/logs?sessionId=${sessionId}&limit=10000`);
  const logs = await res.json();
  if (logs.length === 0) return;

  logs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const date = new Date(session.startedAt).toISOString().split('T')[0];
  const lines = [
    `# ${session.projectName} — Session Transcript`,
    '',
    `| 항목 | 값 |`,
    `|------|-----|`,
    `| 세션 ID | \`${session.sessionId}\` |`,
    `| 디렉토리 | \`${session.cwd}\` |`,
    `| 시작 | ${new Date(session.startedAt).toLocaleString('ko-KR')} |`,
    session.endedAt ? `| 종료 | ${new Date(session.endedAt).toLocaleString('ko-KR')} |` : null,
    session.model ? `| 모델 | ${session.model} |` : null,
    `| 총 이벤트 | ${session.totalEvents} |`,
    '',
    '---',
    '',
  ].filter(Boolean);

  for (const log of logs) {
    const time = new Date(log.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (log.prompt) {
      lines.push(`### 💬 Prompt (${time})`, '', log.prompt, '');
    } else if (log.response) {
      lines.push(`### 🤖 Response (${time})`, '', log.response, '');
    } else if (log.tool) {
      const input = log.input;
      let detail = '';
      if (input?.file_path) detail = `\`${input.file_path}\``;
      else if (input?.command) detail = `\`${input.command}\``;
      else if (input?.pattern) detail = `\`${input.pattern}\``;
      lines.push(`> 🔧 **${log.tool}** ${detail} (${time})`, '');
    } else if (log.event === 'SessionStart') {
      lines.push(`> ▶️ 세션 시작 (${time})`, '');
    } else if (log.event === 'SessionEnd') {
      lines.push(`> ⏹ 세션 종료 (${time})`, '');
    }
  }

  const filename = `${date}-${session.projectName.replace(/[^a-zA-Z0-9가-힣-_]/g, '_')}.md`;
  downloadFile(lines.join('\n'), filename, 'text/markdown');
}

// --- Modal ---

export function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.textContent = 'Copied!';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  });
}

export function showModal(title, text) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = text;
  document.getElementById('modal-overlay').classList.add('active');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// Export for theme toggle integration
export { updateTerminalTheme };
