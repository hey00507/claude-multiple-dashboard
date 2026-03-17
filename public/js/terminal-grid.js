/**
 * Terminal Grid — shows multiple PTY sessions simultaneously
 * Each cell has its own xterm.js instance + WebSocket connection
 */

const gridView = document.getElementById('terminal-grid-view');
const gridContainer = document.getElementById('terminal-grid');
const gridCount = document.getElementById('terminal-grid-count');
const mainLayout = document.getElementById('main-layout');

/** @type {Map<string, {terminal: Terminal, fitAddon: FitAddon, ws: WebSocket|null, resizeObs: ResizeObserver}>} */
const cells = new Map();

let visible = false;

export function isGridVisible() {
  return visible;
}

export function showGrid() {
  visible = true;
  gridView.removeAttribute('hidden');
  mainLayout.setAttribute('hidden', '');
  refreshGrid();
}

export function hideGrid() {
  visible = false;
  gridView.setAttribute('hidden', '');
  mainLayout.removeAttribute('hidden');
  // Pause all WS but keep cells alive
  for (const [, cell] of cells) {
    if (cell.ws) {
      cell.ws.onclose = null;
      cell.ws.close();
      cell.ws = null;
    }
  }
}

export function destroyGrid() {
  for (const [ptyId, cell] of cells) {
    cell.resizeObs.disconnect();
    if (cell.ws) { cell.ws.onclose = null; cell.ws.close(); }
    cell.terminal.dispose();
    cells.delete(ptyId);
  }
  gridContainer.innerHTML = '';
}

/** Fetch active PTY sessions and render grid */
export async function refreshGrid() {
  if (!visible) return;

  // Fetch sessions with PTY
  const res = await fetch('/api/sessions');
  if (!res.ok) return;
  const sessions = await res.json();
  const ptySessions = sessions.filter(s => s.source === 'pty' && s.ptyId);

  gridCount.textContent = `${ptySessions.length}개 PTY 세션`;

  if (ptySessions.length === 0) {
    gridContainer.innerHTML = '<p class="empty-state" style="padding:48px 0">활성 PTY 세션이 없습니다.<br>"+ 새 세션"으로 시작하세요.</p>';
    return;
  }

  // Remove cells for PTYs that no longer exist
  for (const ptyId of cells.keys()) {
    if (!ptySessions.some(s => s.ptyId === ptyId)) {
      removeCell(ptyId);
    }
  }

  // Add/update cells
  for (const session of ptySessions) {
    if (!cells.has(session.ptyId)) {
      addCell(session);
    }
  }

  // Update grid layout based on count
  const count = ptySessions.length;
  if (count === 1) {
    gridContainer.style.gridTemplateColumns = '1fr';
  } else if (count === 2) {
    gridContainer.style.gridTemplateColumns = '1fr 1fr';
  } else if (count <= 4) {
    gridContainer.style.gridTemplateColumns = '1fr 1fr';
  } else {
    gridContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
  }
}

function addCell(session) {
  const ptyId = session.ptyId;
  const el = document.createElement('div');
  el.className = 'terminal-grid-cell';
  el.dataset.ptyId = ptyId;

  const header = document.createElement('div');
  header.className = 'terminal-grid-cell-header';
  header.innerHTML = `
    <span class="tgc-title"><span class="status-dot ${session.status}"></span>${session.projectName}</span>
    <span class="tgc-cwd">${session.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
  `;
  el.appendChild(header);

  const termEl = document.createElement('div');
  termEl.className = 'terminal-grid-cell-body';
  el.appendChild(termEl);

  gridContainer.appendChild(el);

  // Create xterm instance
  const terminal = new window.Terminal({
    theme: getGridTerminalTheme(),
    fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
    fontSize: 12,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 3000,
    convertEol: true,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termEl);

  requestAnimationFrame(() => fitAddon.fit());

  // Input → WS
  terminal.onData((data) => {
    const cell = cells.get(ptyId);
    if (cell?.ws?.readyState === WebSocket.OPEN) {
      cell.ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Resize observer
  const resizeObs = new ResizeObserver(() => {
    fitAddon.fit();
    const cell = cells.get(ptyId);
    if (cell?.ws?.readyState === WebSocket.OPEN) {
      cell.ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  });
  resizeObs.observe(termEl);

  const cell = { terminal, fitAddon, ws: null, resizeObs };
  cells.set(ptyId, cell);

  // Connect WebSocket
  connectCell(ptyId);
}

function connectCell(ptyId) {
  const cell = cells.get(ptyId);
  if (!cell) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal/${ptyId}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'resize', cols: cell.terminal.cols, rows: cell.terminal.rows }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        cell.terminal.write(msg.data);
      } else if (msg.type === 'exit') {
        cell.terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        // Update header
        const el = gridContainer.querySelector(`[data-pty-id="${ptyId}"] .tgc-title .status-dot`);
        if (el) { el.className = 'status-dot ended'; }
      }
    } catch {}
  };

  ws.onclose = () => {
    // Auto reconnect if grid is visible and cell exists
    if (visible && cells.has(ptyId)) {
      setTimeout(() => connectCell(ptyId), 2000);
    }
  };

  cell.ws = ws;
}

function removeCell(ptyId) {
  const cell = cells.get(ptyId);
  if (!cell) return;
  cell.resizeObs.disconnect();
  if (cell.ws) { cell.ws.onclose = null; cell.ws.close(); }
  cell.terminal.dispose();
  cells.delete(ptyId);
  const el = gridContainer.querySelector(`[data-pty-id="${ptyId}"]`);
  if (el) el.remove();
}

function getGridTerminalTheme() {
  const isDark = !document.documentElement.hasAttribute('data-theme') ||
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return isDark ? {
    background: '#0d1117', foreground: '#e6edf3', cursor: '#e6edf3',
    selectionBackground: '#3b82f640',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#b1bac4',
  } : {
    background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328',
    selectionBackground: '#3b82f630',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
    blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  };
}

/** Update themes for all grid terminals */
export function updateGridTheme() {
  const theme = getGridTerminalTheme();
  for (const [, cell] of cells) {
    cell.terminal.options.theme = theme;
  }
}
