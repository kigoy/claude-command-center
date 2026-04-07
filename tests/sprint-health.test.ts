import { describe, it, expect } from 'vitest';
import { getHealth, timeAgo, nextAction, getProjectColor } from '../frontend/src/utils/sprint-health.js';
import type { SprintSummary } from '../frontend/src/types.js';

function makeSprint(overrides: Partial<SprintSummary> = {}): SprintSummary {
  return {
    feature: 'feat-test',
    phase: 'BUILD',
    blocked: false,
    blocked_reason: null,
    last_activity: new Date().toISOString(),
    atoms_total: 0,
    atoms_completed: 0,
    has_atoms: false,
    projectId: 'proj',
    projectPath: '/tmp',
    tmux_session: null,
    ...overrides,
  } as SprintSummary;
}

describe('getHealth', () => {
  it('returns complete for COMPLETE phase', () => {
    expect(getHealth(makeSprint({ phase: 'COMPLETE' }))).toBe('complete');
  });

  it('returns blocked when sprint is blocked', () => {
    expect(getHealth(makeSprint({ blocked: true }))).toBe('blocked');
  });

  it('returns stale when last_activity > 4 hours ago', () => {
    const old = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    expect(getHealth(makeSprint({ last_activity: old }))).toBe('stale');
  });

  it('returns on_track for recent activity', () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(getHealth(makeSprint({ last_activity: recent }))).toBe('on_track');
  });
});

describe('timeAgo', () => {
  it('returns minutes for < 1 hour', () => {
    const ts = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    expect(timeAgo(ts)).toBe('15m ago');
  });

  it('returns hours for < 24 hours', () => {
    const ts = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(timeAgo(ts)).toBe('3h ago');
  });

  it('returns days for >= 24 hours', () => {
    const ts = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    expect(timeAgo(ts)).toBe('2d ago');
  });

  it('returns empty string for invalid date', () => {
    expect(timeAgo('not-a-date')).toBe('');
  });
});

describe('nextAction', () => {
  it('shows blocked reason when blocked', () => {
    const s = makeSprint({ blocked: true, blocked_reason: 'waiting on PR' });
    expect(nextAction(s)).toBe('Blocked: waiting on PR');
  });

  it('shows atom progress when atoms exist', () => {
    const s = makeSprint({ phase: 'BUILD', atoms_total: 5, atoms_completed: 2, has_atoms: true });
    expect(nextAction(s)).toBe('Build atom 3/5');
  });

  it('suggests atomize when no atoms and has_atoms=false', () => {
    const s = makeSprint({ phase: 'BUILD', atoms_total: 0, has_atoms: false });
    expect(nextAction(s)).toBe('Run /atomize');
  });

  it('suggests /review in REVIEW phase', () => {
    expect(nextAction(makeSprint({ phase: 'REVIEW' }))).toBe('Run /review');
  });

  it('suggests /qa in QA phase', () => {
    expect(nextAction(makeSprint({ phase: 'QA' }))).toBe('Run /qa');
  });

  it('suggests ship in SHIP phase', () => {
    expect(nextAction(makeSprint({ phase: 'SHIP' }))).toBe('Ship it');
  });
});

describe('getProjectColor', () => {
  it('returns same color for same project ID', () => {
    expect(getProjectColor('my-project')).toBe(getProjectColor('my-project'));
  });

  it('returns a hex color string', () => {
    const color = getProjectColor('any-project');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
