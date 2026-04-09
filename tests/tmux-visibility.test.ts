import { describe, it, expect } from 'vitest';
import {
  getLastSprintActivity,
  isStaleSprintState,
  shouldAutoKillTmuxSession,
  shouldExposeTmuxSession,
} from '../server/tmux-visibility.js';
import type { SprintState } from '../server/sprint-state.js';

function makeState(overrides: Partial<SprintState & { archived?: boolean }> = {}): SprintState & { archived?: boolean } {
  const now = new Date().toISOString();
  return {
    feature: 'feat-test',
    branch: 'main',
    created: now,
    phase: 'PLAN',
    phase_history: [{ phase: 'PLAN', entered: now }],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
    activity_history: [],
    ...overrides,
  };
}

describe('tmux visibility', () => {
  it('prefers activity history when computing last activity', () => {
    const state = makeState({
      created: '2026-04-08T09:00:00Z',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-08T09:00:00Z' }],
      activity_history: [{ ts: '2026-04-08T12:00:00Z' }],
    });
    expect(getLastSprintActivity(state)).toBe('2026-04-08T12:00:00Z');
  });

  it('marks old unfinished sprints as stale', () => {
    const now = Date.parse('2026-04-09T12:00:00Z');
    const state = makeState({
      created: '2026-04-09T00:00:00Z',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-09T00:00:00Z' }],
    });
    expect(isStaleSprintState(state, now)).toBe(true);
  });

  it('does not expose stale tmux sessions', () => {
    const now = Date.parse('2026-04-09T12:00:00Z');
    const state = makeState({
      created: '2026-04-09T00:00:00Z',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-09T00:00:00Z' }],
    });
    expect(shouldExposeTmuxSession(state, now)).toBe(false);
  });

  it('does not expose archived sessions', () => {
    expect(shouldExposeTmuxSession(makeState({ archived: true }))).toBe(false);
  });

  it('exposes current non-stale sessions', () => {
    const now = Date.parse('2026-04-09T12:00:00Z');
    const state = makeState({
      created: '2026-04-09T10:30:00Z',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-09T10:30:00Z' }],
    });
    expect(shouldExposeTmuxSession(state, now)).toBe(true);
  });

  it('auto-kills stale inactive sessions', () => {
    const now = Date.parse('2026-04-09T12:00:00Z');
    const state = makeState({
      created: '2026-04-09T00:00:00Z',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-09T00:00:00Z' }],
    });
    expect(shouldAutoKillTmuxSession(state, false, now)).toBe(true);
  });

  it('does not auto-kill active sessions even if stale', () => {
    const now = Date.parse('2026-04-09T12:00:00Z');
    const state = makeState({
      created: '2026-04-09T00:00:00Z',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-09T00:00:00Z' }],
    });
    expect(shouldAutoKillTmuxSession(state, true, now)).toBe(false);
  });
});
