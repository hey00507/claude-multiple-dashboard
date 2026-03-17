import { state, STATUS_ICONS, PAGE_SIZE } from './state.js';
import { todayStr, formatDateLabel, htmlEscape, truncate, downloadFile } from './utils.js';
import { getProjectName, getSessionStatus } from './sessions.js';
import { copyToClipboard } from './detail.js';

const historyEl = document.getElementById('history-list');
const historyTitle = document.getElementById('history-title');
const historyFooter = document.getElementById('history-footer');
const projectFilterEl = document.getElementById('project-filter');

// --- Filters ---

function matchesEventFilter(log) {
  if (state.activeEventFilter === 'all') return true;
  if (state.activeEventFilter === 'prompt') return !!log.prompt;
  if (state.activeEventFilter === 'response') return !!log.response;
  if (state.activeEventFilter === 'tool') return !!log.tool;
  if (state.activeEventFilter === 'session') return log.event === 'SessionStart' || log.event === 'SessionEnd';
  return true;
}

function matchesProjectFilter(log) {
  if (state.activeProjectFilter === 'all') return true;
  return log.sessionId === state.activeProjectFilter;
}

function matchesSearch(log) {
  if (!state.searchQuery) return true;
  const q = state.searchQuery.toLowerCase();
  if (log.prompt && log.prompt.toLowerCase().includes(q)) return true;
  if (log.response && log.response.toLowerCase().includes(q)) return true;
  if (log.tool && log.tool.toLowerCase().includes(q)) return true;
  if (log.input?.file_path && log.input.file_path.toLowerCase().includes(q)) return true;
  if (log.input?.command && log.input.command.toLowerCase().includes(q)) return true;
  return false;
}

export function getFilteredLogs() {
  return state.historyLogs.filter(log => matchesEventFilter(log) && matchesProjectFilter(log) && matchesSearch(log));
}

export function updateProjectFilter() {
  const prev = projectFilterEl.value;
  const sessionIds = [...new Set(state.historyLogs.map(l => l.sessionId))];

  projectFilterEl.innerHTML = '<option value="all">모든 프로젝트</option>';
  for (const id of sessionIds) {
    const name = getProjectName(id);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    projectFilterEl.appendChild(opt);
  }

  if (sessionIds.includes(prev)) {
    projectFilterEl.value = prev;
    state.activeProjectFilter = prev;
  } else {
    state.activeProjectFilter = 'all';
  }
}

function updateHistoryTitle() {
  const isToday = state.historyDate === todayStr();
  historyTitle.textContent = isToday ? '오늘의 활동' : `${formatDateLabel(state.historyDate)} 활동`;
}

export function renderHistory() {
  const filtered = getFilteredLogs();

  if (state.historyLogs.length === 0) {
    const isToday = state.historyDate === todayStr();
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
    const copyText = log.prompt || log.response || null;
    const copyBtn = copyText ? `<button class="btn-copy" data-copy-text="${htmlEscape(copyText)}">copy</button>` : '';
    const viewBtn = fullText ? `<button class="btn-view" data-modal-title="${log.response ? '🤖 Response' : '💬 Prompt'}" data-modal-text="${htmlEscape(fullText)}">view</button>` : '';

    return `
      <div class="history-item">
        <span class="time">${time}</span>
        <span class="project">${icon} ${htmlEscape(projectName)}</span>
        <span class="detail">${detail}${copyBtn}${viewBtn}</span>
      </div>
    `;
  }).join('');
}

export async function fetchHistory(append = false) {
  if (!append) {
    state.historyOffset = 0;
    state.historyLogs = [];
    historyEl.innerHTML = '<p class="loading-state">로딩 중...</p>';
  }

  try {
    const res = await fetch(`/api/logs?date=${state.historyDate}&limit=${PAGE_SIZE}&offset=${state.historyOffset}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const logs = await res.json();

    state.historyLogs = append ? state.historyLogs.concat(logs) : logs;
    state.historyHasMore = logs.length >= PAGE_SIZE;
    historyFooter.hidden = !state.historyHasMore;
    updateProjectFilter();
    renderHistory();
    updateHistoryTitle();
  } catch (err) {
    historyEl.innerHTML = `<p class="error-state">히스토리 로딩 실패: ${err.message}</p>`;
    historyFooter.hidden = true;
  }
}

// --- Export ---

export function exportJSON() {
  const filtered = getFilteredLogs();
  if (filtered.length === 0) return;
  const json = JSON.stringify(filtered, null, 2);
  downloadFile(json, `claude-logs-${state.historyDate}.json`, 'application/json');
}

export function exportCSV() {
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
  downloadFile([headers.join(','), ...rows].join('\n'), `claude-logs-${state.historyDate}.csv`, 'text/csv');
}

// --- Stats ---

const statsSection = document.getElementById('stats-section');
const statsGrid = document.getElementById('stats-grid');
const statsTools = document.getElementById('stats-tools');

function formatIdleTime(ms) {
  if (ms === 0) return '-';
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function renderStats(stats) {
  statsGrid.innerHTML = `
    <div class="stat-card clickable" data-filter="all"><div class="stat-value">${stats.totalEvents}</div><div class="stat-label">총 이벤트</div></div>
    <div class="stat-card clickable" data-filter="prompt"><div class="stat-value">${stats.prompts}</div><div class="stat-label">프롬프트</div></div>
    <div class="stat-card clickable" data-filter="response"><div class="stat-value">${stats.responses}</div><div class="stat-label">응답</div></div>
    <div class="stat-card" data-filter="session"><div class="stat-value">${stats.sessions}</div><div class="stat-label">세션</div></div>
    <div class="stat-card"><div class="stat-value">${formatIdleTime(stats.avgIdleGapMs)}</div><div class="stat-label">평균 대기</div></div>
  `;

  const toolEntries = Object.entries(stats.tools).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (toolEntries.length === 0) {
    statsTools.innerHTML = '';
    return;
  }
  const maxCount = toolEntries[0][1];
  statsTools.innerHTML = `
    <div class="stats-tools-title">도구 사용 Top ${toolEntries.length}</div>
    ${toolEntries.map(([name, count]) => `
      <div class="tool-bar-row">
        <span class="tool-bar-name">${htmlEscape(name)}</span>
        <div class="tool-bar-track"><div class="tool-bar-fill" style="width:${(count / maxCount * 100).toFixed(1)}%"></div></div>
        <span class="tool-bar-count">${count}</span>
      </div>
    `).join('')}
  `;
}

export function applyFilterFromStats(filter) {
  state.activeEventFilter = filter;
  // Sync filter chips in UI
  const chips = document.querySelectorAll('#event-filters .filter-chip');
  chips.forEach(c => c.classList.toggle('active', c.dataset.filter === filter));
  renderHistory();
  // Scroll to history
  document.getElementById('history').scrollIntoView({ behavior: 'smooth' });
}

export async function fetchStats() {
  try {
    const res = await fetch(`/api/stats?date=${state.historyDate}`);
    if (!res.ok) { statsSection.hidden = true; return; }
    const stats = await res.json();
    renderStats(stats);
    statsSection.hidden = false;
  } catch {
    statsSection.hidden = true;
  }
}
