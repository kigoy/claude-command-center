import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface SprintState {
  feature: string;
  branch: string;
  created: string;
  phase: string;
  phase_history: unknown[];
  qa_routing: Record<string, unknown>;
  blocked: boolean;
  blocked_reason: string | null;
}

export interface ChainStatus {
  plan_done: boolean;
  review_done: boolean;
  qa_done: boolean;
  qa_required: boolean;
}

/** Read and parse STATE.json for a sprint. Returns null on any error. */
export function readSprintState(sprintDir: string): SprintState | null {
  const statePath = join(sprintDir, 'STATE.json');
  try {
    const raw = readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as SprintState;
  } catch {
    return null;
  }
}

/** Write STATE.json atomically. */
export function writeSprintState(sprintDir: string, state: SprintState): void {
  const statePath = join(sprintDir, 'STATE.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

/** Derive chain gate completion status from phase_history and qa_routing. */
export function deriveChainStatus(state: SprintState): ChainStatus {
  const history = state.phase_history as Array<Record<string, unknown>>;
  const phasesCompleted = new Set(
    history.filter((e) => e.exited).map((e) => e.phase as string),
  );

  return {
    plan_done: phasesCompleted.has('PLAN'),
    review_done: phasesCompleted.has('REVIEW'),
    qa_done: phasesCompleted.has('QA'),
    qa_required: state.qa_routing?.has_ui === true,
  };
}
