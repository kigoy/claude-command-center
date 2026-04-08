/**
 * Batch executor: runs launchable rows sequentially and persists state
 * transitions after each attempt. Blocked rows are skipped and remain blocked.
 * The same batch cannot be executed concurrently (in-process dedupe guard).
 *
 * `executeBatchWithDeps` accepts injected dependencies — testable without DB.
 * `executeBatch` is the production entry point; it lazily imports DB/session
 * deps so the module can be loaded in test environments without triggering
 * the better-sqlite3 native binary.
 */

import type { BatchState, LaunchBatch, LaunchRow, RowState } from './batch-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchRunResult {
  batchId: string;
  created: number;
  failed: number;
  blocked: number;
  finalState: BatchState;
}

/** Minimal session-like return value needed after launch. */
export interface LaunchedSession {
  id: string;
  tmux_name: string | null;
}

/** All external dependencies the runner needs; injectable for tests. */
export interface BatchRunnerDeps {
  getBatch: (id: string) => LaunchBatch | undefined;
  getRowsByBatch: (batchId: string) => LaunchRow[];
  updateBatchState: (id: string, state: BatchState) => void;
  updateRowState: (id: string, state: RowState) => void;
  setRowCreated: (id: string, sessionId: string, tmuxName: string) => void;
  setRowFailed: (id: string, errorMessage: string) => void;
  incrementBatchCreated: (id: string) => void;
  incrementBatchFailed: (id: string) => void;
  launchSession: (row: LaunchRow) => LaunchedSession;
}

// ---------------------------------------------------------------------------
// In-process dedupe guard
// ---------------------------------------------------------------------------

const activeBatchIds = new Set<string>();

/** Returns true if a batch is currently being executed in this process. */
export function isExecuting(batchId: string): boolean {
  return activeBatchIds.has(batchId);
}

// ---------------------------------------------------------------------------
// Core executor (injectable deps)
// ---------------------------------------------------------------------------

/**
 * Execute a batch with injected dependencies.
 * This is the testable core — use `executeBatch` for the real path.
 *
 * Throws for: batch not found, non-pending state, or concurrent execution.
 * Individual row failures are captured and persisted; they do NOT throw.
 */
export async function executeBatchWithDeps(
  batchId: string,
  deps: BatchRunnerDeps,
): Promise<BatchRunResult> {
  if (activeBatchIds.has(batchId)) {
    throw new Error(`Batch ${batchId} is already executing`);
  }

  const batch = deps.getBatch(batchId);
  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }
  if (batch.state !== 'pending') {
    throw new Error(`Batch ${batchId} cannot execute in state '${batch.state}'`);
  }

  activeBatchIds.add(batchId);

  try {
    deps.updateBatchState(batchId, 'launching');

    const rows = deps.getRowsByBatch(batchId);
    const launchable = rows.filter((r) => r.state === 'launchable');
    const blocked = rows.filter((r) => r.state === 'blocked');

    let created = 0;
    let failed = 0;

    for (const row of launchable) {
      deps.updateRowState(row.id, 'launching');

      try {
        const session = deps.launchSession(row);
        deps.setRowCreated(row.id, session.id, session.tmux_name ?? '');
        deps.incrementBatchCreated(batchId);
        created++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        deps.setRowFailed(row.id, message);
        deps.incrementBatchFailed(batchId);
        failed++;
      }
    }

    const finalState = deriveFinalBatchState(created, failed, launchable.length);
    deps.updateBatchState(batchId, finalState);

    return { batchId, created, failed, blocked: blocked.length, finalState };
  } catch (err) {
    // Fatal pre-row error: best-effort batch state update before re-throwing.
    try {
      deps.updateBatchState(batchId, 'failed');
    } catch {
      // Don't mask the original error.
    }
    throw err;
  } finally {
    activeBatchIds.delete(batchId);
  }
}

// ---------------------------------------------------------------------------
// Public entry point (real deps — lazy-loaded to avoid db.ts at module load)
// ---------------------------------------------------------------------------

/**
 * Execute a batch by id using the real database and session creation.
 * Rows are launched in position order. Blocked rows are skipped.
 *
 * DB/session imports are deferred so this module can be safely imported
 * in test environments without triggering the native better-sqlite3 binary.
 */
export async function executeBatch(batchId: string): Promise<BatchRunResult> {
  const [store, sessions] = await Promise.all([
    import('./batch-store.js'),
    import('./sessions.js'),
  ]);

  return executeBatchWithDeps(batchId, {
    getBatch: store.getBatch,
    getRowsByBatch: store.getRowsByBatch,
    updateBatchState: store.updateBatchState,
    updateRowState: store.updateRowState,
    setRowCreated: store.setRowCreated,
    setRowFailed: store.setRowFailed,
    incrementBatchCreated: store.incrementBatchCreated,
    incrementBatchFailed: store.incrementBatchFailed,
    launchSession: (row) => {
      const session = sessions.createSession(row.normalized_name, row.cwd, { toolId: row.tool_id });
      return { id: session.id, tmux_name: session.tmux_name };
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deriveFinalBatchState(
  created: number,
  failed: number,
  launchableTotal: number,
): BatchState {
  // No launchable rows — everything was blocked.
  if (launchableTotal === 0) return 'partial';
  // Every launchable row succeeded.
  if (created === launchableTotal) return 'completed';
  // Some or all rows failed individually — partial success.
  return 'partial';
}
