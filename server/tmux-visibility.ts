import {
  getLastSprintActivity as getSharedLastSprintActivity,
  isStaleSprintState as isSharedStaleSprintState,
  shouldExposeTmuxSession as shouldSharedExposeTmuxSession,
} from '../shared/sprint-health.js';
import type { SprintState } from './sprint-state.js';

export function getLastSprintActivity(state: SprintState): string {
  return getSharedLastSprintActivity(state);
}

export function isStaleSprintState(state: SprintState, now = Date.now()): boolean {
  return isSharedStaleSprintState(state, now);
}

export function shouldExposeTmuxSession(state: SprintState | null, now = Date.now()): boolean {
  return shouldSharedExposeTmuxSession(state, now);
}

export function shouldAutoKillTmuxSession(
  state: SprintState | null,
  agentActive: boolean,
  now = Date.now(),
): boolean {
  if (!state) return false;
  if (agentActive) return false;
  return !shouldExposeTmuxSession(state, now);
}
