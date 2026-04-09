import type { SprintState } from './sprint-state.js';

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function collectTimestamps(state: SprintState): string[] {
  const timestamps: string[] = [];

  if (typeof state.created === 'string' && state.created) {
    timestamps.push(state.created);
  }

  for (const entry of state.phase_history as Array<{ entered?: string; exited?: string }>) {
    if (typeof entry.entered === 'string' && entry.entered) timestamps.push(entry.entered);
    if (typeof entry.exited === 'string' && entry.exited) timestamps.push(entry.exited);
  }

  for (const entry of (state.activity_history as Array<{ ts?: string }> | undefined) ?? []) {
    if (typeof entry?.ts === 'string' && entry.ts) timestamps.push(entry.ts);
  }

  return timestamps;
}

export function getLastSprintActivity(state: SprintState): string {
  let latest = state.created;
  let latestMs = Number.isNaN(new Date(latest).getTime()) ? 0 : new Date(latest).getTime();

  for (const ts of collectTimestamps(state)) {
    const ms = new Date(ts).getTime();
    if (!Number.isNaN(ms) && ms > latestMs) {
      latest = ts;
      latestMs = ms;
    }
  }

  return latest;
}

export function isStaleSprintState(state: SprintState, now = Date.now()): boolean {
  if (state.phase === 'COMPLETE' || state.blocked) return false;
  const lastActivityMs = new Date(getLastSprintActivity(state)).getTime();
  if (Number.isNaN(lastActivityMs)) return false;
  return now - lastActivityMs > STALE_THRESHOLD_MS;
}

export function shouldExposeTmuxSession(state: SprintState | null, now = Date.now()): boolean {
  if (!state) return false;
  if ((state as SprintState & { archived?: boolean }).archived === true) return false;
  if (state.phase === 'COMPLETE') return false;
  if (isStaleSprintState(state, now)) return false;
  return true;
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
