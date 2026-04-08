import { describe, it, expect, beforeEach } from 'vitest';
import { executeBatchWithDeps, isExecuting, type BatchRunnerDeps, type LaunchedSession } from '../server/batch-runner.js';
import type { LaunchBatch, LaunchRow, BatchState, RowState } from '../server/batch-types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeBatch(overrides: Partial<LaunchBatch> = {}): LaunchBatch {
  return {
    id: 'batch-1',
    state: 'pending',
    total_rows: 2,
    launchable_count: 1,
    created_count: 0,
    failed_count: 0,
    interrupted_count: 0,
    created_at: '2024-01-01T00:00:00',
    updated_at: '2024-01-01T00:00:00',
    ...overrides,
  };
}

function makeRow(overrides: Partial<LaunchRow> = {}): LaunchRow {
  return {
    id: 'row-1',
    batch_id: 'batch-1',
    position: 0,
    state: 'launchable',
    project_id: 'acme',
    row_kind: 'sprint-existing',
    normalized_name: 'auth-flow',
    label: 'acme / auth-flow',
    cwd: '/repos/acme',
    tool_id: 'claude',
    session_id: null,
    tmux_name: null,
    blocked_reason: null,
    error_message: null,
    created_at: '2024-01-01T00:00:00',
    updated_at: '2024-01-01T00:00:00',
    ...overrides,
  };
}

function makeSession(id: string): LaunchedSession {
  return { id, tmux_name: `cc-${id}` };
}

// ---------------------------------------------------------------------------
// Mock deps builder
// ---------------------------------------------------------------------------

interface MockDepsState {
  batchStates: BatchState[];
  rowStateHistory: Record<string, RowState[]>;
  rowCreated: Record<string, { sessionId: string; tmuxName: string }>;
  rowFailed: Record<string, string>;
  createdCount: number;
  failedCount: number;
}

function makeDeps(
  batch: LaunchBatch,
  rows: LaunchRow[],
  launchFn: (row: LaunchRow) => LaunchedSession,
): { deps: BatchRunnerDeps; state: MockDepsState } {
  const batchStates: BatchState[] = [];
  const rowStateHistory: Record<string, RowState[]> = {};
  const rowCreated: Record<string, { sessionId: string; tmuxName: string }> = {};
  const rowFailed: Record<string, string> = {};
  let createdCount = 0;
  let failedCount = 0;

  const deps: BatchRunnerDeps = {
    getBatch: (id) => (id === batch.id ? batch : undefined),
    getRowsByBatch: (id) => (id === batch.id ? rows : []),
    updateBatchState: (_id, s) => { batchStates.push(s); },
    updateRowState: (id, s) => {
      if (!rowStateHistory[id]) rowStateHistory[id] = [];
      rowStateHistory[id].push(s);
    },
    setRowCreated: (id, sessionId, tmuxName) => { rowCreated[id] = { sessionId, tmuxName }; },
    setRowFailed: (id, message) => { rowFailed[id] = message; },
    incrementBatchCreated: () => { createdCount++; },
    incrementBatchFailed: () => { failedCount++; },
    launchSession: launchFn,
  };

  return { deps, state: { batchStates, rowStateHistory, rowCreated, rowFailed, createdCount, failedCount } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeBatchWithDeps — basic flow', () => {
  it('returns created=1 and finalState=completed for a single launchable row', async () => {
    const row = makeRow();
    const { deps } = makeDeps(makeBatch(), [row], () => makeSession('sess-abc'));

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.blocked).toBe(0);
    expect(result.finalState).toBe('completed');
  });

  it('transitions batch state: pending → launching → completed', async () => {
    const row = makeRow();
    const { deps, state } = makeDeps(makeBatch(), [row], () => makeSession('sess-abc'));

    await executeBatchWithDeps('batch-1', deps);

    expect(state.batchStates).toEqual(['launching', 'completed']);
  });

  it('transitions row state through launching → (setRowCreated called)', async () => {
    const row = makeRow();
    const { deps, state } = makeDeps(makeBatch(), [row], () => makeSession('sess-abc'));

    await executeBatchWithDeps('batch-1', deps);

    expect(state.rowStateHistory['row-1']).toContain('launching');
    expect(state.rowCreated['row-1']).toEqual({ sessionId: 'sess-abc', tmuxName: 'cc-sess-abc' });
  });

  it('sets row tmux_name to empty string when session has no tmux_name', async () => {
    const row = makeRow();
    const { deps, state } = makeDeps(makeBatch(), [row], () => ({ id: 'sess-1', tmux_name: null }));

    await executeBatchWithDeps('batch-1', deps);

    expect(state.rowCreated['row-1'].tmuxName).toBe('');
  });
});

describe('executeBatchWithDeps — blocked rows', () => {
  it('skips blocked rows and does not call launchSession for them', async () => {
    const blocked = makeRow({ id: 'row-b', state: 'blocked', blocked_reason: 'unknown project' });
    let launched = 0;
    const { deps, state } = makeDeps(makeBatch({ total_rows: 1, launchable_count: 0 }), [blocked], () => {
      launched++;
      return makeSession('sess-x');
    });

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(launched).toBe(0);
    expect(result.created).toBe(0);
    expect(result.blocked).toBe(1);
    expect(state.rowStateHistory['row-b']).toBeUndefined();
  });

  it('blocked rows do not affect batch final state (partial when no launchable)', async () => {
    const blocked = makeRow({ id: 'row-b', state: 'blocked', blocked_reason: 'bad kind' });
    const { deps } = makeDeps(makeBatch(), [blocked], () => makeSession('sess-x'));

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(result.finalState).toBe('partial');
  });
});

describe('executeBatchWithDeps — partial success', () => {
  it('captures row failure without throwing, continues to next row', async () => {
    const rows = [
      makeRow({ id: 'row-1', position: 0 }),
      makeRow({ id: 'row-2', position: 1, normalized_name: 'billing' }),
    ];
    let call = 0;
    const { deps, state } = makeDeps(makeBatch({ total_rows: 2, launchable_count: 2 }), rows, (row) => {
      call++;
      if (call === 1) throw new Error('tmux failed');
      return makeSession(`sess-${call}`);
    });

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.finalState).toBe('partial');
    expect(state.rowFailed['row-1']).toBe('tmux failed');
    expect(state.rowCreated['row-2']).toBeDefined();
  });

  it('persists error message for failed row', async () => {
    const row = makeRow();
    const { deps, state } = makeDeps(makeBatch(), [row], () => {
      throw new Error('session prefix missing');
    });

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(result.failed).toBe(1);
    expect(state.rowFailed['row-1']).toBe('session prefix missing');
    expect(result.finalState).toBe('partial');
  });

  it('finalState is partial when some rows fail', async () => {
    const rows = [
      makeRow({ id: 'row-1', position: 0 }),
      makeRow({ id: 'row-2', position: 1, normalized_name: 'other' }),
      makeRow({ id: 'row-3', position: 2, normalized_name: 'third', state: 'blocked', blocked_reason: 'x' }),
    ];
    let call = 0;
    const { deps } = makeDeps(makeBatch(), rows, () => {
      call++;
      if (call === 2) throw new Error('fail');
      return makeSession(`s${call}`);
    });

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.finalState).toBe('partial');
  });

  it('all rows created gives completed even when blocked rows exist', async () => {
    const rows = [
      makeRow({ id: 'row-1', position: 0 }),
      makeRow({ id: 'row-b', position: 1, state: 'blocked', blocked_reason: 'bad' }),
    ];
    const { deps } = makeDeps(makeBatch(), rows, () => makeSession('sess-ok'));

    const result = await executeBatchWithDeps('batch-1', deps);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.finalState).toBe('completed');
  });
});

describe('executeBatchWithDeps — error conditions', () => {
  it('throws when batch not found', async () => {
    const { deps } = makeDeps(makeBatch(), [], () => makeSession('x'));

    await expect(executeBatchWithDeps('nonexistent', deps)).rejects.toThrow('Batch not found');
  });

  it('throws when batch is not in pending state', async () => {
    const batch = makeBatch({ state: 'launching' });
    const { deps } = makeDeps(batch, [], () => makeSession('x'));

    await expect(executeBatchWithDeps('batch-1', deps)).rejects.toThrow("cannot execute in state 'launching'");
  });

  it('marks batch as failed when a pre-row fatal error occurs', async () => {
    // Simulate a fatal error by making getRowsByBatch throw
    const batch = makeBatch();
    const batchStates: BatchState[] = [];
    const deps: BatchRunnerDeps = {
      getBatch: () => batch,
      getRowsByBatch: () => { throw new Error('DB gone'); },
      updateBatchState: (_id, s) => { batchStates.push(s); },
      updateRowState: () => {},
      setRowCreated: () => {},
      setRowFailed: () => {},
      incrementBatchCreated: () => {},
      incrementBatchFailed: () => {},
      launchSession: () => makeSession('x'),
    };

    await expect(executeBatchWithDeps('batch-1', deps)).rejects.toThrow('DB gone');
    expect(batchStates).toContain('failed');
  });
});

describe('executeBatchWithDeps — dedupe guard', () => {
  it('rejects duplicate submission via the deps.getBatch override trick', async () => {
    // Simulate a second submission while the first is still "in flight" by
    // checking that isExecuting returns false once execution completes.
    // The actual concurrent guard operates synchronously at the start.
    const row = makeRow();
    const { deps } = makeDeps(makeBatch(), [row], () => makeSession('sess-1'));

    let seenExecuting = false;
    const origLaunch = deps.launchSession;
    deps.launchSession = (r) => {
      seenExecuting = isExecuting('batch-1');
      return origLaunch(r);
    };

    await executeBatchWithDeps('batch-1', deps);
    expect(seenExecuting).toBe(true);
    expect(isExecuting('batch-1')).toBe(false);
  });

  it('throws "already executing" when submitted twice before first completes', async () => {
    // We can verify the guard by injecting deps that register the batch id
    // as active and then trying to execute. We do this by checking the error
    // thrown by a second synchronous invocation from within launchSession.
    let secondCallError: Error | null = null;
    const row = makeRow();
    const batch = makeBatch();
    const batchStates: BatchState[] = [];

    const deps: BatchRunnerDeps = {
      getBatch: (id) => (id === batch.id ? batch : undefined),
      getRowsByBatch: () => [row],
      updateBatchState: (_id, s) => { batchStates.push(s); },
      updateRowState: () => {},
      setRowCreated: () => {},
      setRowFailed: () => {},
      incrementBatchCreated: () => {},
      incrementBatchFailed: () => {},
      launchSession: (_r) => {
        // By the time launchSession is called, the batch is registered as active.
        // Attempt a second execution — it must be rejected immediately.
        executeBatchWithDeps('batch-1', {
          getBatch: (id) => (id === batch.id ? batch : undefined),
          getRowsByBatch: () => [],
          updateBatchState: () => {},
          updateRowState: () => {},
          setRowCreated: () => {},
          setRowFailed: () => {},
          incrementBatchCreated: () => {},
          incrementBatchFailed: () => {},
          launchSession: () => makeSession('x'),
        }).catch((err: Error) => { secondCallError = err; });
        return makeSession('first-sess');
      },
    };

    await executeBatchWithDeps('batch-1', deps);
    // The second call rejection propagates asynchronously.
    await Promise.resolve();
    expect(secondCallError).not.toBeNull();
    expect(secondCallError!.message).toContain('already executing');
  });

  it('allows re-execution after first run completes', async () => {
    const row = makeRow();
    const batch = makeBatch();
    // Use a stateful mock that tracks batch state changes so the second
    // call sees the updated (non-pending) state.
    let currentBatchState: BatchState = 'pending';
    const batchStates: BatchState[] = [];
    const deps: BatchRunnerDeps = {
      getBatch: (id) => (id === batch.id ? { ...batch, state: currentBatchState } : undefined),
      getRowsByBatch: () => [row],
      updateBatchState: (_id, s) => { currentBatchState = s; batchStates.push(s); },
      updateRowState: () => {},
      setRowCreated: () => {},
      setRowFailed: () => {},
      incrementBatchCreated: () => {},
      incrementBatchFailed: () => {},
      launchSession: () => makeSession('sess-1'),
    };

    await executeBatchWithDeps('batch-1', deps);

    // Guard is cleared after completion.
    expect(isExecuting('batch-1')).toBe(false);
    // Batch is no longer pending after execution.
    expect(currentBatchState).toBe('completed');

    // A second attempt on the non-pending batch throws a state error, not dedupe.
    await expect(executeBatchWithDeps('batch-1', deps)).rejects.toThrow("cannot execute in state");
  });
});

describe('executeBatchWithDeps — row ordering', () => {
  it('processes rows in position order', async () => {
    const rows = [
      makeRow({ id: 'row-2', position: 1, normalized_name: 'second' }),
      makeRow({ id: 'row-0', position: 0, normalized_name: 'first' }),
    ];
    // Sort by position to match getRowsByBatch contract (already sorted in store)
    rows.sort((a, b) => a.position - b.position);

    const launched: string[] = [];
    const { deps } = makeDeps(makeBatch({ launchable_count: 2 }), rows, (row) => {
      launched.push(row.normalized_name);
      return makeSession(`sess-${row.id}`);
    });

    await executeBatchWithDeps('batch-1', deps);

    expect(launched).toEqual(['first', 'second']);
  });
});

describe('isExecuting', () => {
  it('returns false for a batch that is not running', () => {
    expect(isExecuting('some-nonexistent-batch')).toBe(false);
  });
});
