import { describe, expect, it } from 'vitest';
import { reviewSprintState } from '../server/sprint-review.js';
import type { SprintState } from '../server/sprint-state.js';

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    feature: 'feat-sample',
    branch: 'main',
    created: '2026-04-01T00:00:00.000Z',
    phase: 'BUILD',
    phase_history: [
      { phase: 'PLAN', entered: '2026-04-01T00:00:00.000Z', exited: '2026-04-01T00:10:00.000Z' },
      { phase: 'BUILD', entered: '2026-04-01T00:10:00.000Z' },
    ],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
    ...overrides,
  };
}

describe('reviewSprintState', () => {
  it('returns green for a healthy started sprint', () => {
    const report = reviewSprintState({
      state: makeState(),
      tmuxActive: true,
      hasAtoms: true,
      atomsTotal: 3,
      now: Date.parse('2026-04-01T01:00:00.000Z'),
    });

    expect(report.status).toBe('green');
    expect(report.still_valid).toBe(true);
    expect(report.started).toBe(true);
    expect(report.state_correct).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('returns amber for a valid sprint that has not started yet', () => {
    const report = reviewSprintState({
      state: makeState({
        phase: 'PLAN',
        phase_history: [{ phase: 'PLAN', entered: '2026-04-01T00:00:00.000Z' }],
      }),
      tmuxActive: false,
      hasAtoms: false,
      atomsTotal: 0,
      now: Date.parse('2026-04-01T01:00:00.000Z'),
    });

    expect(report.status).toBe('amber');
    expect(report.still_valid).toBe(true);
    expect(report.started).toBe(false);
    expect(report.state_correct).toBe(true);
  });

  it('returns amber when the sprint looks stale and should be revalidated', () => {
    const report = reviewSprintState({
      state: makeState(),
      tmuxActive: false,
      hasAtoms: false,
      atomsTotal: 0,
      now: Date.parse('2026-04-12T12:00:00.000Z'),
    });

    expect(report.status).toBe('amber');
    expect(report.still_valid).toBe(false);
    expect(report.state_correct).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'stale_validity')).toBe(true);
  });

  it('returns red when current phase does not match the open history entry', () => {
    const report = reviewSprintState({
      state: makeState({
        phase: 'REVIEW',
      }),
      tmuxActive: false,
      hasAtoms: true,
      atomsTotal: 2,
      now: Date.parse('2026-04-01T01:00:00.000Z'),
    });

    expect(report.status).toBe('red');
    expect(report.state_correct).toBe(false);
    expect(report.findings.some((finding) => finding.code === 'history_phase_mismatch')).toBe(true);
  });

  it('returns red when UI QA is required but the sprint skipped QA', () => {
    const report = reviewSprintState({
      state: makeState({
        phase: 'SHIP',
        phase_history: [
          { phase: 'PLAN', entered: '2026-04-01T00:00:00.000Z', exited: '2026-04-01T00:10:00.000Z' },
          { phase: 'BUILD', entered: '2026-04-01T00:10:00.000Z', exited: '2026-04-01T01:00:00.000Z' },
          { phase: 'REVIEW', entered: '2026-04-01T01:00:00.000Z', exited: '2026-04-01T01:30:00.000Z' },
          { phase: 'SHIP', entered: '2026-04-01T01:30:00.000Z' },
        ],
        qa_routing: { has_ui: true },
      }),
      tmuxActive: false,
      hasAtoms: true,
      atomsTotal: 5,
      now: Date.parse('2026-04-01T02:00:00.000Z'),
    });

    expect(report.status).toBe('red');
    expect(report.state_correct).toBe(false);
    expect(report.findings.some((finding) => finding.code === 'qa_missing')).toBe(true);
  });
});
