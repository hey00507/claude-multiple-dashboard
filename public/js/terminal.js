/** @type {Terminal | null} */
let terminal = null;
/** @type {WebSocket | null} */
let ws = null;
/** @type {FitAddon | null} */
let fitAddon = null;
/** @type {string | null} */
let currentPtyId = null;
let reconnectTimer = null;
let connectionState = 'disconnected'; // 'connected' | 'disconnected' | 'reconnecting' | 'exited'
let userDisconnected = false; // true only when user explicitly disconnects
let processExited = false;

const RECONNECT_DELAY = 2000;

export function initTerminal(container) {
  if (terminal) {
    terminal.dispose();
  }

  terminal = new window.Terminal({
    theme: getTerminalTheme(),
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    convertEol: true,
  });

  fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  // Send input to WebSocket
  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    }
  });
  resizeObserver.observe(container);

  return terminal;
}

export function connectTerminal(ptyId) {
  // Already connected to this PTY
  if (currentPtyId === ptyId && ws && ws.readyState === WebSocket.OPEN) return;

  // Reconnecting to same PTY — don't reset
  if (currentPtyId === ptyId && !processExited && !userDisconnected) {
    // Already trying to reconnect
    if (connectionState === 'reconnecting') return;
  }

  // Switching to a different PTY
  if (currentPtyId !== ptyId) {
    hardDisconnect();
    // Clear terminal screen for the new PTY (scrollback will come from server)
    if (terminal) {
      terminal.clear();
      terminal.reset();
    }
  }

  currentPtyId = ptyId;
  userDisconnected = false;
  processExited = false;

  doConnect(ptyId);
}

function doConnect(ptyId) {
  if (userDisconnected || processExited) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/terminal/${ptyId}`;

  setConnectionState('reconnecting');
  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnectionState('connected');

    if (terminal) {
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'output':
          if (terminal) terminal.write(msg.data);
          break;
        case 'exit':
          processExited = true;
          setConnectionState('exited');
          if (terminal) terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
          break;
        case 'error':
          if (terminal) terminal.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
          break;
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    // Don't reconnect if user disconnected or process exited
    if (userDisconnected || processExited) return;

    // Auto-reconnect indefinitely until user disconnects or process exits
    if (currentPtyId === ptyId) {
      setConnectionState('reconnecting');
      reconnectTimer = setTimeout(() => doConnect(ptyId), RECONNECT_DELAY);
    }
  };

  ws.onerror = () => {
    // onclose will handle reconnect
  };
}

/** Pause WebSocket (when switching tabs) but keep state for resume */
export function pauseTerminal() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  // Don't change connectionState or currentPtyId — we'll resume later
}

/** Resume connection after pause */
export function resumeTerminal() {
  if (!currentPtyId || processExited || userDisconnected) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;
  doConnect(currentPtyId);
}

/** User explicitly disconnects — stop all reconnection */
export function disconnectTerminal() {
  userDisconnected = true;
  hardDisconnect();
  setConnectionState('disconnected');
}

function hardDisconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  currentPtyId = null;

  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

export function disposeTerminal() {
  hardDisconnect();
  if (terminal) {
    terminal.dispose();
    terminal = null;
    fitAddon = null;
  }
}

export function fitTerminal() {
  if (fitAddon && terminal) {
    fitAddon.fit();
  }
}

export function getConnectionState() {
  return connectionState;
}

export function getCurrentPtyId() {
  return currentPtyId;
}

function setConnectionState(newState) {
  connectionState = newState;
  updateConnectionIndicator();
}

function updateConnectionIndicator() {
  const indicator = document.getElementById('terminal-status');
  if (!indicator) return;

  const labels = {
    connected: '연결됨',
    disconnected: '연결 끊김',
    reconnecting: '재연결 중...',
    exited: '프로세스 종료',
  };
  const colors = {
    connected: 'var(--green)',
    disconnected: 'var(--text-muted)',
    reconnecting: 'var(--yellow)',
    exited: 'var(--text-muted)',
  };

  indicator.textContent = labels[connectionState] || '';
  indicator.style.color = colors[connectionState] || '';
}

function getTerminalTheme() {
  const isDark = !document.documentElement.hasAttribute('data-theme') ||
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return isDark ? {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#e6edf3',
    cursorAccent: '#0d1117',
    selectionBackground: '#3b82f640',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39d353',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d364',
    brightWhite: '#f0f6fc',
  } : {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#1f2328',
    cursorAccent: '#ffffff',
    selectionBackground: '#3b82f630',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  };
}

export function updateTerminalTheme() {
  if (terminal) {
    terminal.options.theme = getTerminalTheme();
  }
}
