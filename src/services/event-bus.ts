import { EventEmitter } from 'events';
import type { Session, LogEvent } from '../types.js';

class EventBus extends EventEmitter {
  broadcast(session: Session) {
    this.emit('session_update', session);
  }

  broadcastLog(log: LogEvent) {
    this.emit('log_update', log);
  }
}

export const eventBus = new EventBus();
