import { useEffect, useRef, useCallback } from 'react';
import type { SprintSummary } from '../types';

interface SprintUpdateEvent {
  projectId: string;
  feature: string;
  sprint: SprintSummary;
}

type OnSprintUpdate = (event: SprintUpdateEvent) => void;

/**
 * Subscribe to sprint SSE updates from the server.
 * Calls onUpdate whenever a sprint's STATE.json or ATOMS.md changes.
 * Auto-reconnects on disconnect.
 */
export function useSprintSSE(onUpdate: OnSprintUpdate): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const connect = useCallback(() => {
    const es = new EventSource('/api/sprint-events');

    es.addEventListener('sprint-update', (event) => {
      try {
        const data = JSON.parse(event.data) as SprintUpdateEvent;
        onUpdateRef.current(data);
      } catch {
        // Malformed event — ignore
      }
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 5s
      setTimeout(connect, 5000);
    };

    return es;
  }, []);

  useEffect(() => {
    const es = connect();
    return () => es.close();
  }, [connect]);
}
