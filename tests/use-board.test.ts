import { describe, it, expect } from 'vitest';
import { isBoardVisibleSprint } from '../frontend/src/hooks/use-board.js';

function makeSprint(overrides: Partial<{
  archived: boolean;
  phase: string;
  blocked: boolean;
  last_activity: string;
}> = {}) {
  return {
    archived: false,
    phase: 'PLAN',
    blocked: false,
    last_activity: new Date().toISOString(),
    ...overrides,
  };
}

describe('isBoardVisibleSprint', () => {
  it('hides stale unfinished sprints by default', () => {
    const old = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    expect(isBoardVisibleSprint(makeSprint({ last_activity: old }))).toBe(false);
  });

  it('shows stale sprints when the stale filter is active', () => {
    const old = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    expect(isBoardVisibleSprint(makeSprint({ last_activity: old }), { filterHealth: 'stale' })).toBe(true);
  });

  it('hides archived sprints unless done is shown', () => {
    expect(isBoardVisibleSprint(makeSprint({ archived: true }))).toBe(false);
    expect(isBoardVisibleSprint(makeSprint({ archived: true }), { showDone: true })).toBe(true);
  });
});
