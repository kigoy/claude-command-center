/**
 * Shared batch state contract for launch batches and launch rows.
 * These types are the single source of truth consumed by batch-store.ts,
 * the batch runner, route handlers, and (mirrored) by frontend/src/types.ts.
 */

/** Lifecycle states for an individual launch row */
export type RowState =
  | 'launchable'    // valid, ready to launch
  | 'blocked'       // invalid / missing info, cannot launch
  | 'launching'     // tmux session creation in progress
  | 'created'       // session successfully created
  | 'failed'        // launch attempt failed with an error
  | 'interrupted';  // batch was interrupted before this row was processed

/** Lifecycle states for a launch batch */
export type BatchState =
  | 'pending'     // rows parsed, not yet launched
  | 'launching'   // executor is actively running rows
  | 'completed'   // all launchable rows reached 'created'
  | 'partial'     // some rows created, some failed/interrupted
  | 'interrupted' // startup recovery found an unfinished batch
  | 'failed';     // executor encountered a fatal error before any row launched

/** Persisted launch batch record */
export interface LaunchBatch {
  id: string;
  state: BatchState;
  total_rows: number;
  launchable_count: number;
  created_count: number;
  failed_count: number;
  interrupted_count: number;
  created_at: string;
  updated_at: string;
}

/** Persisted launch row record */
export interface LaunchRow {
  id: string;
  batch_id: string;
  position: number;         // 0-based order within the batch
  state: RowState;
  project_id: string;       // owning project for the row
  row_kind: string;         // sprint-existing | explore-existing
  normalized_name: string;  // canonical row name used in UI
  label: string;            // display/session label hint shown in UI
  cwd: string;              // working directory for the session
  tool_id: string;          // e.g. 'claude'
  session_id: string | null;    // linked session id once created
  tmux_name: string | null;     // tmux session name once created
  blocked_reason: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Shape used to insert a new batch (counts start at 0, state defaults to pending) */
export interface NewBatch {
  id: string;
  total_rows: number;
  launchable_count: number;
}

/** Shape used to insert a new row */
export interface NewRow {
  id: string;
  batch_id: string;
  position: number;
  state: RowState;
  project_id: string;
  row_kind: string;
  normalized_name: string;
  label: string;
  cwd: string;
  tool_id: string;
  blocked_reason?: string | null;
}
