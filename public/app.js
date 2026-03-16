import { state, PAGE_SIZE } from './js/state.js';
import { todayStr, formatDateLabel } from './js/utils.js';
import { renderSessions, sortSessions } from './js/sessions.js';
import { fetchHistory, renderHistory, exportJSON, exportCSV, fetchStats } from './js/history.js';
import { openDetail, closeDetail, closeModal, showModal, deleteSessionFromPanel, killSession, launchSession, renameSession, deleteAllInactiveSessions } from './js/detail.js';
import { connectSSE, requestNotificationPermission } from './js/sse.js';
import './js/theme.js';

// --- DOM refs ---

const dateSelect = document.getElementById('date-filter-history');
const searchInput = document.getElementById('search-input');
const eventFiltersEl = document.getElementById('event-filters');
const projectFilterEl = document.getElementById('project-filter');
const loadMoreBtn = document.getElementById('load-more');
const detailPanel = document.getElementById('detail-panel');

// Expose modal for inline onclick handlers
window.showModal = showModal;
window.closeModal = closeModal;

// --- Date Selector ---

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
  dateSelect.value = state.historyDate;
}

// --- Fetch Sessions ---

async function fetchSessions() {
  const sessionsEl = document.getElementById('sessions');
  sessionsEl.innerHTML = '<p class="loading-state">세션 로딩 중...</p>';
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.sessions = await res.json();
    renderSessions();
  } catch (err) {
    sessionsEl.innerHTML = `<p class="error-state">세션 로딩 실패: ${err.message}</p>`;
  }
}

// --- Event Handlers ---

dateSelect.addEventListener('change', () => {
  state.historyDate = dateSelect.value;
  fetchHistory();
  fetchStats();
});

eventFiltersEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  state.activeEventFilter = chip.dataset.filter;
  eventFiltersEl.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderHistory();
});

projectFilterEl.addEventListener('change', () => {
  state.activeProjectFilter = projectFilterEl.value;
  renderHistory();
});

let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.searchQuery = searchInput.value.trim();
    renderHistory();
  }, 200);
});

loadMoreBtn.addEventListener('click', () => {
  state.historyOffset += PAGE_SIZE;
  fetchHistory(true);
});

document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('detail-delete').addEventListener('click', () => {
  if (state.selectedSessionId) deleteSessionFromPanel(state.selectedSessionId);
});
document.getElementById('detail-kill').addEventListener('click', () => {
  if (state.selectedSessionId) killSession(state.selectedSessionId);
});
document.getElementById('btn-new-session').addEventListener('click', launchSession);
document.getElementById('btn-export-json').addEventListener('click', exportJSON);
document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

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

  const card = e.target.closest('.session-card');
  if (card) {
    openDetail(card.dataset.sessionId);
    return;
  }
});

// --- Shortcuts Panel ---

const shortcutsPanel = document.getElementById('shortcuts-panel');

function toggleShortcuts() {
  shortcutsPanel.hidden = !shortcutsPanel.hidden;
}

document.getElementById('btn-shortcuts').addEventListener('click', toggleShortcuts);
document.getElementById('shortcuts-close').addEventListener('click', () => { shortcutsPanel.hidden = true; });

// --- Keyboard ---

document.addEventListener('keydown', (e) => {
  const isTyping = document.activeElement === searchInput;

  if (e.key === 'Escape') {
    if (isTyping) { searchInput.blur(); return; }
    if (!shortcutsPanel.hidden) { shortcutsPanel.hidden = true; return; }
    if (document.getElementById('modal-overlay').classList.contains('active')) {
      closeModal();
    } else if (state.selectedSessionId) {
      closeDetail();
    }
    return;
  }

  if (isTyping) return;

  if (e.key === '?') {
    toggleShortcuts();
    return;
  }

  const sorted = sortSessions([...state.sessions]);
  if (!sorted.length) return;

  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault();
    const currentIdx = sorted.findIndex(s => s.sessionId === state.selectedSessionId);
    let nextIdx;
    if (e.key === 'j') {
      nextIdx = currentIdx < sorted.length - 1 ? currentIdx + 1 : 0;
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : sorted.length - 1;
    }
    openDetail(sorted[nextIdx].sessionId);
  } else if (e.key === 'Enter' && state.selectedSessionId) {
    e.preventDefault();
    detailPanel.classList.toggle('fullview');
  } else if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
  }
});

// --- Init ---

initDateSelector();
fetchSessions();
fetchHistory();
fetchStats();
connectSSE();
requestNotificationPermission();
