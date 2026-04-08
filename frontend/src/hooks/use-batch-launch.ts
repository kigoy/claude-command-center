import { useCallback, useEffect, useRef, useState } from 'react';
import type { BatchState, LaunchBatch, LaunchRow } from '../types';

export type BatchLaunchStatus = 'idle' | 'submitting' | 'running' | 'settled' | 'error';
export type BatchTransport = 'idle' | 'live' | 'polling';

interface BatchSnapshot {
  batch: LaunchBatch;
  rows: LaunchRow[];
}

const SETTLED_STATES = new Set<BatchState>(['completed', 'partial', 'interrupted', 'failed']);
const POLL_INTERVAL_MS = 2_000;

function isSettledState(state: BatchState | null | undefined): boolean {
  return !!state && SETTLED_STATES.has(state);
}

export function useBatchLaunch() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BatchSnapshot | null>(null);
  const [status, setStatus] = useState<BatchLaunchStatus>('idle');
  const [transport, setTransport] = useState<BatchTransport>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSnapshot = snapshot !== null;
  const batchState = snapshot?.batch.state ?? null;

  const stopRealtime = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const refreshBatch = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/batches/${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => ({}))) as {
        batch?: LaunchBatch;
        rows?: LaunchRow[];
        error?: string;
      };
      if (!res.ok || !body.batch || !Array.isArray(body.rows)) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setSnapshot({ batch: body.batch, rows: body.rows });

      if (isSettledState(body.batch.state)) {
        stopRealtime();
        setTransport('idle');
        setStatus('settled');
      } else {
        setStatus('running');
      }

      return body;
    },
    [stopRealtime],
  );

  const startPolling = useCallback(
    (id: string) => {
      if (pollTimerRef.current) return;
      setTransport('polling');
      pollTimerRef.current = setInterval(() => {
        void refreshBatch(id).catch(() => {
          // Keep the last successful snapshot visible while polling retries.
        });
      }, POLL_INTERVAL_MS);
    },
    [refreshBatch],
  );

  const launchBatch = useCallback(
    async (text: string) => {
      stopRealtime();
      setBatchId(null);
      setSnapshot(null);
      setTransport('idle');
      setStatus('submitting');
      setErrorMessage(null);

      try {
        const res = await fetch('/api/batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          batchId?: string;
          batch?: LaunchBatch;
          rows?: LaunchRow[];
          error?: string;
        };
        if (!res.ok || !body.batchId || !body.batch || !Array.isArray(body.rows)) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        setBatchId(body.batchId);
        setSnapshot({ batch: body.batch, rows: body.rows });

        if (isSettledState(body.batch.state)) {
          setStatus('settled');
        } else {
          setStatus('running');
        }
      } catch (err) {
        stopRealtime();
        setTransport('idle');
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [stopRealtime],
  );

  useEffect(() => {
    if (!batchId || !hasSnapshot || status === 'error' || isSettledState(batchState)) {
      return;
    }

    let cancelled = false;
    setTransport('live');

    const eventSource = new EventSource(`/api/batch-events?batchId=${encodeURIComponent(batchId)}`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('batch-changed', () => {
      if (cancelled) return;
      void refreshBatch(batchId).catch(() => {
        if (cancelled) return;
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
        startPolling(batchId);
      });
    });

    eventSource.onerror = () => {
      if (cancelled) return;
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
      startPolling(batchId);
    };

    void refreshBatch(batchId).catch(() => {
      if (!cancelled) startPolling(batchId);
    });

    return () => {
      cancelled = true;
      if (eventSourceRef.current === eventSource) {
        eventSource.close();
        eventSourceRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [batchId, batchState, hasSnapshot, refreshBatch, startPolling, status]);

  return {
    batchId,
    batch: snapshot?.batch ?? null,
    rows: snapshot?.rows ?? [],
    status,
    transport,
    errorMessage,
    launchBatch,
    isLaunching: status === 'submitting' || status === 'running',
  };
}
