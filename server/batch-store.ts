/**
 * CRUD operations for launch_batches and launch_rows.
 * All reads and writes go through this module — route handlers and the
 * batch runner should not query these tables directly.
 */

import db from './db.js';
import type {
  BatchState,
  LaunchBatch,
  LaunchRow,
  NewBatch,
  NewRow,
  RowState,
} from './batch-types.js';

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

const stmts = {
  insertBatch: db.prepare<[string, number, number]>(`
    INSERT INTO launch_batches (id, total_rows, launchable_count)
    VALUES (?, ?, ?)
  `),

  getBatch: db.prepare<[string]>(`
    SELECT * FROM launch_batches WHERE id = ?
  `),

  listBatches: db.prepare(`
    SELECT * FROM launch_batches ORDER BY created_at DESC
  `),

  updateBatchState: db.prepare<[BatchState, string]>(`
    UPDATE launch_batches
    SET state = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  incrementBatchCreated: db.prepare<[string]>(`
    UPDATE launch_batches
    SET created_count = created_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `),

  incrementBatchFailed: db.prepare<[string]>(`
    UPDATE launch_batches
    SET failed_count = failed_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `),

  incrementBatchInterrupted: db.prepare<[string]>(`
    UPDATE launch_batches
    SET interrupted_count = interrupted_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `),

  // ---------------------------------------------------------------------------
  // Row operations
  // ---------------------------------------------------------------------------

  insertRow: db.prepare<[string, string, number, RowState, string, string, string, string, string, string, string | null]>(`
    INSERT INTO launch_rows (
      id, batch_id, position, state, project_id, row_kind, normalized_name, label, cwd, tool_id, blocked_reason
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getRow: db.prepare<[string]>(`
    SELECT * FROM launch_rows WHERE id = ?
  `),

  getRowsByBatch: db.prepare<[string]>(`
    SELECT * FROM launch_rows WHERE batch_id = ? ORDER BY position ASC
  `),

  updateRowState: db.prepare<[RowState, string]>(`
    UPDATE launch_rows
    SET state = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  setRowCreated: db.prepare<[string, string, string]>(`
    UPDATE launch_rows
    SET state = 'created', session_id = ?, tmux_name = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  setRowFailed: db.prepare<[string, string]>(`
    UPDATE launch_rows
    SET state = 'failed', error_message = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  getLaunchingBatchIds: db.prepare(`
    SELECT DISTINCT batch_id FROM launch_rows WHERE state = 'launching'
  `),

  markBatchRowsInterrupted: db.prepare<[string]>(`
    UPDATE launch_rows
    SET state = 'interrupted', updated_at = datetime('now')
    WHERE batch_id = ? AND state = 'launching'
  `),

  getBatchRowCounts: db.prepare<[string]>(`
    SELECT
      SUM(CASE WHEN state = 'launchable' THEN 1 ELSE 0 END) AS launchable_count,
      SUM(CASE WHEN state = 'blocked' THEN 1 ELSE 0 END) AS blocked_count,
      SUM(CASE WHEN state = 'created' THEN 1 ELSE 0 END) AS created_count,
      SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN state = 'interrupted' THEN 1 ELSE 0 END) AS interrupted_count,
      SUM(CASE WHEN state = 'launching' THEN 1 ELSE 0 END) AS launching_count
    FROM launch_rows
    WHERE batch_id = ?
  `),

  syncBatchCountsAndState: db.prepare<[number, number, number, BatchState, string]>(`
    UPDATE launch_batches
    SET created_count = ?, failed_count = ?, interrupted_count = ?, state = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
};

function deriveBatchStateFromCounts(counts: {
  launchable_count: number;
  blocked_count: number;
  created_count: number;
  failed_count: number;
  interrupted_count: number;
  launching_count: number;
}): BatchState {
  if (counts.launching_count > 0) return 'launching';
  if (counts.interrupted_count > 0) return 'interrupted';
  if (
    counts.created_count > 0 &&
    counts.failed_count === 0 &&
    counts.interrupted_count === 0 &&
    counts.launchable_count === 0
  ) {
    return 'completed';
  }
  if (counts.created_count > 0 || counts.failed_count > 0) return 'partial';
  if (counts.launchable_count > 0 || counts.blocked_count > 0) return 'pending';
  return 'failed';
}

const markOrphanedLaunchingTxn = db.transaction(() => {
  const batchIds = (stmts.getLaunchingBatchIds.all() as Array<{ batch_id: string }>).map((row) => row.batch_id);

  let interruptedRows = 0;
  for (const batchId of batchIds) {
    const changed = stmts.markBatchRowsInterrupted.run(batchId).changes;
    interruptedRows += changed;

    const rawCounts = stmts.getBatchRowCounts.get(batchId) as
        | {
          launchable_count: number | null;
          blocked_count: number | null;
          created_count: number | null;
          failed_count: number | null;
          interrupted_count: number | null;
          launching_count: number | null;
        }
      | undefined;

    const counts = {
      launchable_count: rawCounts?.launchable_count ?? 0,
      blocked_count: rawCounts?.blocked_count ?? 0,
      created_count: rawCounts?.created_count ?? 0,
      failed_count: rawCounts?.failed_count ?? 0,
      interrupted_count: rawCounts?.interrupted_count ?? 0,
      launching_count: rawCounts?.launching_count ?? 0,
    };

    stmts.syncBatchCountsAndState.run(
      counts.created_count,
      counts.failed_count,
      counts.interrupted_count,
      deriveBatchStateFromCounts(counts),
      batchId,
    );
  }

  return interruptedRows;
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function insertBatch(batch: NewBatch): LaunchBatch {
  stmts.insertBatch.run(batch.id, batch.total_rows, batch.launchable_count);
  return getBatch(batch.id)!;
}

export function getBatch(id: string): LaunchBatch | undefined {
  return stmts.getBatch.get(id) as LaunchBatch | undefined;
}

export function listBatches(): LaunchBatch[] {
  return stmts.listBatches.all() as LaunchBatch[];
}

export function updateBatchState(id: string, state: BatchState): void {
  stmts.updateBatchState.run(state, id);
}

export function incrementBatchCreated(id: string): void {
  stmts.incrementBatchCreated.run(id);
}

export function incrementBatchFailed(id: string): void {
  stmts.incrementBatchFailed.run(id);
}

export function incrementBatchInterrupted(id: string): void {
  stmts.incrementBatchInterrupted.run(id);
}

export function insertRow(row: NewRow): LaunchRow {
  stmts.insertRow.run(
    row.id,
    row.batch_id,
    row.position,
    row.state,
    row.project_id,
    row.row_kind,
    row.normalized_name,
    row.label,
    row.cwd,
    row.tool_id,
    row.blocked_reason ?? null,
  );
  return getRow(row.id)!;
}

export function getRow(id: string): LaunchRow | undefined {
  return stmts.getRow.get(id) as LaunchRow | undefined;
}

export function getRowsByBatch(batchId: string): LaunchRow[] {
  return stmts.getRowsByBatch.all(batchId) as LaunchRow[];
}

export function updateRowState(id: string, state: RowState): void {
  stmts.updateRowState.run(state, id);
}

export function setRowCreated(id: string, sessionId: string, tmuxName: string): void {
  stmts.setRowCreated.run(sessionId, tmuxName, id);
}

export function setRowFailed(id: string, errorMessage: string): void {
  stmts.setRowFailed.run(errorMessage, id);
}

/**
 * Called on startup: any rows still in 'launching' state from a previous
 * process are interrupted because we cannot confirm their actual tmux/session
 * outcome. Rows still in 'launchable' state are left as-is — they have not
 * been acted on and can be treated as part of an unfinished batch.
 */
export function markOrphanedLaunchingRows(): number {
  return markOrphanedLaunchingTxn();
}
