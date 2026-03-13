import { describe, it, expect } from 'vitest';
import { eventBus } from '../src/services/event-bus.js';
import type { Session } from '../src/types.js';

describe('event-bus', () => {
  it('broadcasts session updates to listeners', () => {
    const received: Session[] = [];
    eventBus.on('session_update', (s: Session) => received.push(s));

    const mockSession: Session = {
      sessionId: 'bus-test-001',
      cwd: '/tmp/test',
      projectName: 'test',
      status: 'active',
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      lastEvent: 'SessionStart',
      lastPrompt: null,
      lastToolUsed: null,
      idleSince: null,
      endedAt: null,
      endReason: null,
      totalEvents: 1,
    };

    eventBus.broadcast(mockSession);
    expect(received).toHaveLength(1);
    expect(received[0].sessionId).toBe('bus-test-001');

    eventBus.removeAllListeners('session_update');
  });

  it('supports multiple listeners', () => {
    let count = 0;
    const listener1 = () => count++;
    const listener2 = () => count++;

    eventBus.on('session_update', listener1);
    eventBus.on('session_update', listener2);

    eventBus.broadcast({ sessionId: 'test' } as Session);
    expect(count).toBe(2);

    eventBus.removeAllListeners('session_update');
  });
});
