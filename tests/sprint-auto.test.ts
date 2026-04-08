import { describe, expect, it } from 'vitest';
import { getAutoSprintAction } from '../server/sprint-auto.js';

describe('getAutoSprintAction', () => {
  it('uses autoplan for plan phase', () => {
    expect(getAutoSprintAction({ phase: 'PLAN', qaRequired: false })).toEqual({
      command: '/autoplan',
      toPhase: 'BUILD',
      label: 'Auto It',
    });
  });

  it('routes review to qa when ui qa is required', () => {
    expect(getAutoSprintAction({ phase: 'REVIEW', qaRequired: true })).toEqual({
      command: '/qa',
      toPhase: 'QA',
      label: 'Auto It',
    });
  });

  it('routes review directly to ship when qa is not required', () => {
    expect(getAutoSprintAction({ phase: 'REVIEW', qaRequired: false })).toEqual({
      command: '/ship',
      toPhase: 'SHIP',
      label: 'Auto It',
    });
  });

  it('returns null when there is no automatic next step', () => {
    expect(getAutoSprintAction({ phase: 'SHIP', qaRequired: false })).toBeNull();
    expect(getAutoSprintAction({ phase: 'COMPLETE', qaRequired: false })).toBeNull();
  });
});
