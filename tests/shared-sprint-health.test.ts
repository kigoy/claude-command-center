import { describe, expect, it } from 'vitest';
import {
  getLastSprintActivity,
  isDashboardVisibleSprint,
  isStaleSprintState,
  isStaleSprintSummary,
} from '../shared/sprint-health.js';

describe('shared sprint health', () => {
  it('prefers activity history when computing last activity', () => {
    expect(getLastSprintActivity({
      created: '2026-04-08T09:00:00Z',
      phase: 'PLAN',
      blocked: false,
      phase_history: [{ phase: 'PLAN', entered: '2026-04-08T10:00:00Z' }],
      activity_history: [{ ts: '2026-04-08T12:00:00Z' }],
    })).toBe('2026-04-08T12:00:00Z');
  });

  it('marks unfinished summaries stale after four hours', () => {
    expect(isStaleSprintSummary({
      phase: 'BUILD',
      blocked: false,
      last_activity: '2026-04-09T06:00:00Z',
    }, Date.parse('2026-04-09T12:00:00Z'))).toBe(true);
  });

  it('hides archived or stale summaries from dashboard visibility', () => {
    expect(isDashboardVisibleSprint({
      archived: true,
      phase: 'PLAN',
      blocked: false,
      last_activity: '2026-04-09T11:00:00Z',
    }, Date.parse('2026-04-09T12:00:00Z'))).toBe(false);

    expect(isDashboardVisibleSprint({
      archived: false,
      phase: 'PLAN',
      blocked: false,
      last_activity: '2026-04-09T06:00:00Z',
    }, Date.parse('2026-04-09T12:00:00Z'))).toBe(false);
  });

  it('never marks blocked or complete states stale', () => {
    expect(isStaleSprintState({
      created: '2026-04-09T00:00:00Z',
      phase: 'BUILD',
      blocked: true,
      phase_history: [{ phase: 'BUILD', entered: '2026-04-09T00:00:00Z' }],
      activity_history: [],
    }, Date.parse('2026-04-09T12:00:00Z'))).toBe(false);

    expect(isStaleSprintState({
      created: '2026-04-09T00:00:00Z',
      phase: 'COMPLETE',
      blocked: false,
      phase_history: [{ phase: 'COMPLETE', entered: '2026-04-09T00:00:00Z' }],
      activity_history: [],
    }, Date.parse('2026-04-09T12:00:00Z'))).toBe(false);
  });
});
