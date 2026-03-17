import type { FastifyInstance } from 'fastify';
import { getPty, writePty, resizePty, onData, onExit, getScrollback } from '../services/pty-manager.js';

export async function terminalRoute(app: FastifyInstance) {
  app.get<{ Params: { ptyId: string } }>('/ws/terminal/:ptyId', { websocket: true }, (socket, request) => {
    const { ptyId } = request.params;
    const ptySession = getPty(ptyId);

    if (!ptySession) {
      socket.send(JSON.stringify({ type: 'error', message: 'PTY session not found' }));
      socket.close();
      return;
    }

    // Send scrollback for reconnection
    const scrollback = getScrollback(ptyId);
    if (scrollback) {
      socket.send(JSON.stringify({ type: 'output', data: scrollback }));
    }

    // If PTY already exited (lingering), send exit immediately
    if (ptySession.exited) {
      socket.send(JSON.stringify({ type: 'exit', code: ptySession.exitCode ?? -1 }));
      socket.close();
      return;
    }

    // Forward PTY output → WebSocket
    const removeDataListener = onData((id, data) => {
      if (id !== ptyId) return;
      try {
        socket.send(JSON.stringify({ type: 'output', data }));
      } catch { /* socket closed */ }
    });

    // Forward PTY exit → WebSocket
    const removeExitListener = onExit((id, code) => {
      if (id !== ptyId) return;
      try {
        socket.send(JSON.stringify({ type: 'exit', code }));
        socket.close();
      } catch { /* socket closed */ }
    });

    // Handle client messages
    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());

        switch (msg.type) {
          case 'input':
            writePty(ptyId, msg.data);
            break;
          case 'resize':
            if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              resizePty(ptyId, msg.cols, msg.rows);
            }
            break;
        }
      } catch { /* ignore malformed messages */ }
    });

    socket.on('close', () => {
      removeDataListener();
      removeExitListener();
    });
  });
}
