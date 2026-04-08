import type { SprintState } from './sprint-state.js';

export interface SprintActivityEntry {
  ts: string;
  kind: 'system' | 'action' | 'status' | 'implementation';
  title: string;
  detail?: string;
  phase?: string;
}

export interface SprintHistoryEvent extends SprintActivityEntry {
  source: 'activity' | 'phase' | 'derived';
}

type PhaseHistoryEntry = {
  phase?: string;
  entered?: string;
  exited?: string;
  summary?: string;
};

function historyEntries(state: SprintState): SprintActivityEntry[] {
  if (!Array.isArray(state.activity_history)) return [];
  return (state.activity_history as SprintActivityEntry[]).filter((entry) => typeof entry?.ts === 'string' && typeof entry?.title === 'string');
}

export function appendSprintActivity(
  state: SprintState,
  entry: SprintActivityEntry,
): SprintState {
  return {
    ...state,
    activity_history: [...historyEntries(state), entry],
  };
}

export function buildSprintHistory(state: SprintState): SprintHistoryEvent[] {
  const events: SprintHistoryEvent[] = [];

  events.push({
    ts: state.created,
    kind: 'system',
    title: 'Sprint created',
    detail: state.origin?.type === 'explore-idea' ? 'Created from Explore Idea.' : 'Created from New Sprint.',
    phase: 'PLAN',
    source: 'derived',
  });

  const phaseHistory = Array.isArray(state.phase_history) ? (state.phase_history as PhaseHistoryEntry[]) : [];
  for (const entry of phaseHistory) {
    if (entry.entered && entry.phase) {
      events.push({
        ts: entry.entered,
        kind: 'status',
        title: `Entered ${entry.phase}`,
        detail: entry.exited ? 'Phase completed.' : 'Current active phase.',
        phase: entry.phase,
        source: 'phase',
      });
    }

    if (entry.exited && entry.phase && entry.summary) {
      events.push({
        ts: entry.exited,
        kind: 'implementation',
        title: `Completed ${entry.phase}`,
        detail: entry.summary,
        phase: entry.phase,
        source: 'phase',
      });
    }
  }

  for (const entry of historyEntries(state)) {
    events.push({ ...entry, source: 'activity' });
  }

  return events.sort((a, b) => {
    const aTime = new Date(a.ts).getTime();
    const bTime = new Date(b.ts).getTime();
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });
}
