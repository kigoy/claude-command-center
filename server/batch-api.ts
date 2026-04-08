/**
 * Batch Create API routes.
 *
 * POST /api/batches/preflight  — dry-run validation, no DB writes
 * POST /api/batches            — create + execute (async, returns batchId immediately)
 * GET  /api/batches/:id        — load persisted batch + rows (source of truth)
 *
 * Route handlers compose the existing parser, preflight, and executor modules.
 * No parsing or validation logic is reimplemented here.
 */

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { parseBatchText } from './batch-parse.js';
import { preflightRows } from './batch-preflight.js';
import { getProjects } from './sprint-config.js';
import { listCliTools } from './cli-tools.js';
import { listSessions } from './sessions.js';
import {
  insertBatch,
  insertRow,
  getBatch,
  getRowsByBatch,
  updateBatchState,
  updateRowState,
  setRowCreated,
  setRowFailed,
  incrementBatchCreated,
  incrementBatchFailed,
  failBatchLaunchableRows,
} from './batch-store.js';
import { executeBatchWithDeps } from './batch-runner.js';
import { notifyBatchChanged } from './batch-events.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/batches/preflight
//
// Dry-run validation: parse input text and run preflight checks.
// No database writes occur. Use this to preview row outcomes before launching.
// ---------------------------------------------------------------------------

router.post('/batches/preflight', (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const parsed = parseBatchText(text);
  const result = preflightRows(
    parsed.rows,
    getProjects(),
    listCliTools({ enabledOnly: true }),
    listSessions(),
    parsed.truncated,
  );

  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /api/batches
//
// Create a batch from input text and begin execution immediately.
// Returns 202 with { batchId, batch, rows } — execution continues async.
// Clients should subscribe to GET /api/batch-events?batchId=<id> and refetch
// GET /api/batches/:id as state evolves.
// ---------------------------------------------------------------------------

router.post('/batches', (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const parsed = parseBatchText(text);
  const preflighted = preflightRows(
    parsed.rows,
    getProjects(),
    listCliTools({ enabledOnly: true }),
    listSessions(),
    parsed.truncated,
  );

  if (preflighted.launchable_count === 0) {
    res.status(422).json({
      error: 'No launchable rows',
      rows: preflighted.rows,
      truncated: preflighted.truncated,
    });
    return;
  }

  // Persist batch + rows before responding.
  const batchId = nanoid(10);
  const batch = insertBatch({
    id: batchId,
    total_rows: preflighted.rows.length,
    launchable_count: preflighted.launchable_count,
  });

  for (const row of preflighted.rows) {
    insertRow({
      id: nanoid(10),
      batch_id: batchId,
      position: row.position,
      state: row.state,
      project_id: row.project_id,
      row_kind: row.row_kind,
      normalized_name: row.normalized_name,
      label: row.label,
      cwd: row.cwd,
      tool_id: row.tool_id,
      blocked_reason: row.blocked_reason,
    });
  }

  const rows = getRowsByBatch(batchId);

  // Fire-and-forget: emit SSE invalidations after each row/batch transition.
  runBatchAsync(batchId);

  res.status(202).json({ batchId, batch, rows });
});

// ---------------------------------------------------------------------------
// GET /api/batches/:id
//
// Reload a persisted batch and its rows. Source of truth for the result board.
// Always use this endpoint to reconstruct state — do not rely on SSE payloads.
// ---------------------------------------------------------------------------

router.get('/batches/:id', (req, res) => {
  const batch = getBatch(req.params.id);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json({ batch, rows: getRowsByBatch(req.params.id) });
});

export default router;

// ---------------------------------------------------------------------------
// Internal: async execution with per-transition invalidation events
// ---------------------------------------------------------------------------

/**
 * Execute a batch asynchronously using injected deps that emit a
 * batch-changed event after each meaningful state transition.
 *
 * Sessions are lazy-imported so this module can be loaded in test environments
 * without triggering the real tmux / node-pty layer.
 */
function runBatchAsync(batchId: string): void {
  import('./sessions.js')
    .then((sessions) =>
      executeBatchWithDeps(batchId, {
        getBatch,
        getRowsByBatch,
        updateBatchState: (id, state) => {
          updateBatchState(id, state);
          notifyBatchChanged(batchId);
        },
        updateRowState: (id, state) => {
          updateRowState(id, state);
          notifyBatchChanged(batchId);
        },
        setRowCreated: (id, sessionId, tmuxName) => {
          setRowCreated(id, sessionId, tmuxName);
          notifyBatchChanged(batchId);
        },
        setRowFailed: (id, errorMessage) => {
          setRowFailed(id, errorMessage);
          notifyBatchChanged(batchId);
        },
        incrementBatchCreated,
        incrementBatchFailed,
        launchSession: (row) => {
          const session = sessions.createSession(row.normalized_name, row.cwd, {
            toolId: row.tool_id,
          });
          return { id: session.id, tmux_name: session.tmux_name };
        },
      }),
    )
    .catch((err: unknown) => {
      console.error(`[batch-api] Fatal error executing batch ${batchId}:`, err);
      try {
        const errorMessage = err instanceof Error ? err.message : String(err);
        failBatchLaunchableRows(batchId, errorMessage);
      } catch (updateErr) {
        console.error(`[batch-api] Failed to mark batch ${batchId} as failed:`, updateErr);
      }
      notifyBatchChanged(batchId);
    });
}
