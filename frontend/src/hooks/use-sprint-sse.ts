import { useEffect, useRef } from 'react';
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
 * Auto-reconnects on disconnect with cleanup-safe timeouts.
 */
export function useSprintSSE(onUpdate: OnSprintUpdate): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      es = new EventSource('/api/sprint-events');

      es.addEventListener('sprint-update', (event) => {
        try {
          const data = JSON.parse(event.data) as SprintUpdateEvent;
          onUpdateRef.current(data);
        } catch { /* malformed event */ }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (!unmounted) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);
}
