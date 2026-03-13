import { EventEmitter } from 'events';
import type { Session } from '../types.js';

class EventBus extends EventEmitter {
  broadcast(session: Session) {
    this.emit('session_update', session);
  }
}

export const eventBus = new EventBus();
