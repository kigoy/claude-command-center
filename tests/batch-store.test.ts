/**
 * Integration tests for batch-store.ts CRUD operations.
 * Validates that batch and row records can be created, queried, updated,
 * and that lifecycle transitions produce correct state.
 *
 * These tests hit the real SQLite database via better-sqlite3.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertBatch,
  getBatch,
  listBatches,
  updateBatchState,
  incrementBatchCreated,
  incrementBatchFailed,
  incrementBatchInterrupted,
  insertRow,
  getRow,
  getRowsByBatch,
  updateRowState,
  setRowCreated,
  setRowFailed,
  failBatchLaunchableRows,
  markOrphanedLaunchingRows,
} from '../server/batch-store.js';
import type { NewBatch, NewRow } from '../server/batch-types.js';

let batchCounter = 0;
function uniqueBatchId() {
  return `test-batch-${Date.now()}-${++batchCounter}`;
}

function makeBatch(overrides: Partial<NewBatch> = {}): NewBatch {
  return {
    id: uniqueBatchId(),
    total_rows: 2,
    launchable_count: 1,
    ...overrides,
  };
}

function makeRow(batchId: string, position: number, overrides: Partial<NewRow> = {}): NewRow {
  return {
    id: `${batchId}-row-${position}`,
    batch_id: batchId,
    position,
    state: 'launchable',
    project_id: 'test-proj',
    row_kind: 'sprint-existing',
    normalized_name: `feat-${position}`,
    label: `test-proj / feat-${position}`,
    cwd: '/tmp/test',
    tool_id: 'claude',
    blocked_reason: null,
    ...overrides,
  };
}

describe('batch CRUD', () => {
  it('insertBatch creates a batch retrievable by getBatch', () => {
    const nb = makeBatch();
    const batch = insertBatch(nb);
    expect(batch.id).toBe(nb.id);
    expect(batch.state).toBe('pending');
    expect(batch.total_rows).toBe(2);
    expect(batch.launchable_count).toBe(1);
    expect(batch.created_count).toBe(0);
    expect(batch.failed_count).toBe(0);

    const fetched = getBatch(nb.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(nb.id);
  });

  it('getBatch returns undefined for non-existent batch', () => {
    expect(getBatch('does-not-exist')).toBeUndefined();
  });

  it('listBatches includes the created batch', () => {
    const nb = makeBatch();
    insertBatch(nb);
    const all = listBatches();
    expect(all.some((b) => b.id === nb.id)).toBe(true);
  });

  it('updateBatchState transitions the batch state', () => {
    const nb = makeBatch();
    insertBatch(nb);
    updateBatchState(nb.id, 'launching');
    expect(getBatch(nb.id)!.state).toBe('launching');
    updateBatchState(nb.id, 'completed');
    expect(getBatch(nb.id)!.state).toBe('completed');
  });

  it('incrementBatchCreated increases created_count', () => {
    const nb = makeBatch();
    insertBatch(nb);
    incrementBatchCreated(nb.id);
    expect(getBatch(nb.id)!.created_count).toBe(1);
    incrementBatchCreated(nb.id);
    expect(getBatch(nb.id)!.created_count).toBe(2);
  });

  it('incrementBatchFailed increases failed_count', () => {
    const nb = makeBatch();
    insertBatch(nb);
    incrementBatchFailed(nb.id);
    expect(getBatch(nb.id)!.failed_count).toBe(1);
  });

  it('incrementBatchInterrupted increases interrupted_count', () => {
    const nb = makeBatch();
    insertBatch(nb);
    incrementBatchInterrupted(nb.id);
    expect(getBatch(nb.id)!.interrupted_count).toBe(1);
  });
});

describe('row CRUD', () => {
  it('insertRow creates a row retrievable by getRow', () => {
    const nb = makeBatch();
    insertBatch(nb);
    const nr = makeRow(nb.id, 0);
    const row = insertRow(nr);
    expect(row.id).toBe(nr.id);
    expect(row.state).toBe('launchable');
    expect(row.position).toBe(0);

    const fetched = getRow(nr.id);
    expect(fetched).toBeDefined();
    expect(fetched!.batch_id).toBe(nb.id);
  });

  it('getRow returns undefined for non-existent row', () => {
    expect(getRow('no-such-row')).toBeUndefined();
  });

  it('getRowsByBatch returns rows in position order', () => {
    const nb = makeBatch({ total_rows: 3, launchable_count: 3 });
    insertBatch(nb);
    insertRow(makeRow(nb.id, 2));
    insertRow(makeRow(nb.id, 0));
    insertRow(makeRow(nb.id, 1));
    const rows = getRowsByBatch(nb.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('updateRowState transitions the row state', () => {
    const nb = makeBatch();
    insertBatch(nb);
    const nr = makeRow(nb.id, 0);
    insertRow(nr);
    updateRowState(nr.id, 'launching');
    expect(getRow(nr.id)!.state).toBe('launching');
  });

  it('setRowCreated sets state to created with session info', () => {
    const nb = makeBatch();
    insertBatch(nb);
    const nr = makeRow(nb.id, 0);
    insertRow(nr);
    setRowCreated(nr.id, 'sess-123', 'cc-my-session');
    const row = getRow(nr.id)!;
    expect(row.state).toBe('created');
    expect(row.session_id).toBe('sess-123');
    expect(row.tmux_name).toBe('cc-my-session');
  });

  it('setRowFailed sets state to failed with error message', () => {
    const nb = makeBatch();
    insertBatch(nb);
    const nr = makeRow(nb.id, 0);
    insertRow(nr);
    setRowFailed(nr.id, 'tmux creation failed');
    const row = getRow(nr.id)!;
    expect(row.state).toBe('failed');
    expect(row.error_message).toBe('tmux creation failed');
  });
});

describe('bulk operations', () => {
  it('failBatchLaunchableRows fails only launchable rows', () => {
    const nb = makeBatch({ total_rows: 3, launchable_count: 2 });
    insertBatch(nb);
    insertRow(makeRow(nb.id, 0, { state: 'launchable' }));
    insertRow(makeRow(nb.id, 1, { state: 'blocked', blocked_reason: 'test' }));
    insertRow(makeRow(nb.id, 2, { state: 'launchable' }));

    const count = failBatchLaunchableRows(nb.id, 'bootstrap error');
    expect(count).toBe(2);

    const rows = getRowsByBatch(nb.id);
    expect(rows[0].state).toBe('failed');
    expect(rows[0].error_message).toBe('bootstrap error');
    expect(rows[1].state).toBe('blocked'); // unchanged
    expect(rows[2].state).toBe('failed');
  });

  it('markOrphanedLaunchingRows marks launching rows as interrupted', () => {
    const nb = makeBatch();
    insertBatch(nb);
    updateBatchState(nb.id, 'launching');
    insertRow(makeRow(nb.id, 0, { state: 'launching' }));
    insertRow(makeRow(nb.id, 1, { state: 'created' }));

    const count = markOrphanedLaunchingRows();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(getRow(`${nb.id}-row-0`)!.state).toBe('interrupted');
    expect(getRow(`${nb.id}-row-1`)!.state).toBe('created'); // unchanged
  });
});
