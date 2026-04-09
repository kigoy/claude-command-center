export const DASHBOARD_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
export const REVIEW_STALE_VALIDITY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface SprintStateLike {
  created: string;
  phase: string;
  blocked?: boolean | null;
  archived?: boolean;
  phase_history?: ReadonlyArray<unknown>;
  activity_history?: ReadonlyArray<unknown>;
}

export interface SprintSummaryLike {
  phase: string;
  blocked?: boolean | null;
  archived?: boolean;
  last_activity: string;
}

function hasValidTimestamp(value?: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function isInactiveSprint(phase: string, blocked?: boolean | null): boolean {
  return phase === 'COMPLETE' || blocked === true;
}

function isOlderThanThreshold(
  timestamp: string,
  now: number,
  thresholdMs: number,
): boolean {
  const lastActivityMs = new Date(timestamp).getTime();
  if (Number.isNaN(lastActivityMs)) return false;
  return now - lastActivityMs > thresholdMs;
}

function getObjectValue(entry: unknown, key: string): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export function getLastSprintActivity(state: SprintStateLike): string {
  let latest = state.created;
  let latestMs = hasValidTimestamp(state.created) ? new Date(state.created).getTime() : 0;

  const timestamps = [
    state.created,
    ...((state.phase_history ?? []).flatMap((entry) => [
      getObjectValue(entry, 'entered'),
      getObjectValue(entry, 'exited'),
    ])),
    ...((state.activity_history ?? []).map((entry) => getObjectValue(entry, 'ts'))),
  ];

  for (const timestamp of timestamps) {
    if (!hasValidTimestamp(timestamp)) continue;
    const timestampMs = new Date(timestamp).getTime();
    if (timestampMs > latestMs) {
      latest = timestamp;
      latestMs = timestampMs;
    }
  }

  return latest;
}

export function isStaleSprintState(
  state: SprintStateLike,
  now = Date.now(),
  thresholdMs = DASHBOARD_STALE_THRESHOLD_MS,
): boolean {
  if (isInactiveSprint(state.phase, state.blocked)) return false;
  return isOlderThanThreshold(getLastSprintActivity(state), now, thresholdMs);
}

export function isStaleSprintSummary(
  sprint: SprintSummaryLike,
  now = Date.now(),
  thresholdMs = DASHBOARD_STALE_THRESHOLD_MS,
): boolean {
  if (isInactiveSprint(sprint.phase, sprint.blocked)) return false;
  return isOlderThanThreshold(sprint.last_activity, now, thresholdMs);
}

export function isDashboardVisibleSprint(
  sprint: SprintSummaryLike,
  now = Date.now(),
): boolean {
  return sprint.archived !== true
    && sprint.phase !== 'COMPLETE'
    && !isStaleSprintSummary(sprint, now);
}

export function shouldExposeTmuxSession(
  state: SprintStateLike | null,
  now = Date.now(),
): boolean {
  if (!state) return false;
  if (state.archived === true || state.phase === 'COMPLETE') return false;
  return !isStaleSprintState(state, now);
}
