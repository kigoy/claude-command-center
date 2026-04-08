/**
 * Hook managing draft state and preflight for Batch Create.
 * Draft text is preserved across Draft/Review navigation.
 * Preflight calls POST /api/batches/preflight — no DB writes.
 */
import { useState, useCallback } from 'react';

export const MAX_BATCH_ROWS = 20;

export type PreflightStatus = 'idle' | 'loading' | 'done' | 'error';

export interface PreflightRow {
  position: number;
  project_id: string;
  row_kind: string;
  normalized_name: string;
  label: string;
  tmux_prefix_hint: string;
  cwd: string;
  tool_id: string;
  state: 'launchable' | 'blocked';
  blocked_reason: string | null;
}

export interface PreflightResult {
  rows: PreflightRow[];
  launchable_count: number;
  blocked_count: number;
  truncated: boolean;
}

function countInputRows(text: string): number {
  return text.split('\n').filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('#');
  }).length;
}

export function useBatchCreate() {
  const [draftText, setDraftTextRaw] = useState('');
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [status, setStatus] = useState<PreflightStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rowCount = countInputRows(draftText);
  const overCap = rowCount > MAX_BATCH_ROWS;
  const cappedCount = Math.min(rowCount, MAX_BATCH_ROWS);

  const runPreflight = useCallback(async (): Promise<boolean> => {
    if (!draftText.trim()) return false;
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/batches/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draftText }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as PreflightResult;
      setPreflightResult(result);
      setStatus('done');
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
      return false;
    }
  }, [draftText]);

  // Changing draft clears stale preflight results so preview stays in sync.
  const setDraftText = useCallback(
    (text: string) => {
      setDraftTextRaw(text);
      if (status === 'done' || status === 'error') {
        setStatus('idle');
        setPreflightResult(null);
        setErrorMessage(null);
      }
    },
    [status],
  );

  return {
    draftText,
    setDraftText,
    preflightResult,
    status,
    errorMessage,
    runPreflight,
    rowCount: cappedCount,
    overCap,
  };
}
