/** @type {Terminal | null} */
let terminal = null;
/** @type {WebSocket | null} */
let ws = null;
/** @type {FitAddon | null} */
let fitAddon = null;
/** @type {string | null} */
let currentPtyId = null;
let reconnectTimer = null;
let connectionState = 'disconnected'; // 'connected' | 'disconnected' | 'reconnecting'

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

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

  // Small delay to let DOM settle before fitting
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
  if (currentPtyId === ptyId && ws && ws.readyState === WebSocket.OPEN) return;

  disconnectTerminal();
  currentPtyId = ptyId;
  reconnectAttempts = 0;

  doConnect(ptyId);
}

function doConnect(ptyId) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/terminal/${ptyId}`;

  setConnectionState('reconnecting');
  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectAttempts = 0;
    setConnectionState('connected');

    // Send initial size
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
          setConnectionState('disconnected');
          if (terminal) terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
          break;
        case 'error':
          if (terminal) terminal.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
          break;
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    if (currentPtyId === ptyId && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setConnectionState('reconnecting');
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => doConnect(ptyId), RECONNECT_DELAY);
    } else {
      setConnectionState('disconnected');
    }
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

export function disconnectTerminal() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  currentPtyId = null;
  reconnectAttempts = 0;

  if (ws) {
    ws.onclose = null; // Prevent reconnect
    ws.close();
    ws = null;
  }
  setConnectionState('disconnected');
}

export function disposeTerminal() {
  disconnectTerminal();
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
  };
  const colors = {
    connected: 'var(--green)',
    disconnected: 'var(--red)',
    reconnecting: 'var(--yellow)',
  };

  indicator.textContent = labels[connectionState];
  indicator.style.color = colors[connectionState];
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

/** Re-apply theme (call on theme toggle) */
export function updateTerminalTheme() {
  if (terminal) {
    terminal.options.theme = getTerminalTheme();
  }
}
