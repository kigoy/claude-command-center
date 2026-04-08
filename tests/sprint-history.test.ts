import { describe, expect, it } from 'vitest';
import { appendSprintActivity, buildSprintHistory } from '../server/sprint-history.js';
import type { SprintState } from '../server/sprint-state.js';

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    feature: 'feat-sample',
    branch: 'main',
    created: '2026-04-01T00:00:00.000Z',
    phase: 'BUILD',
    phase_history: [
      { phase: 'PLAN', entered: '2026-04-01T00:00:00.000Z', exited: '2026-04-01T00:15:00.000Z', summary: 'Defined scope.' },
      { phase: 'BUILD', entered: '2026-04-01T00:15:00.000Z' },
    ],
    activity_history: [
      {
        ts: '2026-04-01T00:20:00.000Z',
        kind: 'action',
        title: 'Sent /review',
        detail: 'Queued to the sprint terminal session.',
        phase: 'BUILD',
      },
    ],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
    ...overrides,
  };
}

describe('sprint-history', () => {
  it('builds a combined history with derived, phase, and activity events', () => {
    const history = buildSprintHistory(makeState());

    expect(history[0].title).toBe('Sent /review');
    expect(history.some((event) => event.title === 'Sprint created')).toBe(true);
    expect(history.some((event) => event.title === 'Entered BUILD')).toBe(true);
    expect(history.some((event) => event.title === 'Completed PLAN')).toBe(true);
  });

  it('appends activity entries immutably', () => {
    const state = makeState({ activity_history: [] });
    const next = appendSprintActivity(state, {
      ts: '2026-04-01T00:30:00.000Z',
      kind: 'status',
      title: 'Transitioned BUILD -> REVIEW',
      phase: 'REVIEW',
    });

    expect(state.activity_history).toEqual([]);
    expect(next.activity_history).toHaveLength(1);
    expect((next.activity_history as any[])[0].title).toBe('Transitioned BUILD -> REVIEW');
  });
});
