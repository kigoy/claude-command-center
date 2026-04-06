import { readFileSync } from 'fs';
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
