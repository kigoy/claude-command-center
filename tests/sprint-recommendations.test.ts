import { describe, it, expect } from 'vitest';
import { rankRecommendations } from '../server/sprint-recommendations.js';

describe('rankRecommendations', () => {
  it('ignores archived sprints', () => {
    const recommendations = rankRecommendations([
      {
        projectId: 'alpha',
        feature: 'feat-archived',
        phase: 'PLAN',
        archived: true,
        blocked: false,
        blocked_reason: null,
        atoms_total: 1,
        atoms_completed: 0,
        last_activity: '2026-04-09T08:00:00Z',
      },
      {
        projectId: 'alpha',
        feature: 'feat-active',
        phase: 'PLAN',
        archived: false,
        blocked: false,
        blocked_reason: null,
        atoms_total: 1,
        atoms_completed: 0,
        last_activity: '2026-04-09T07:00:00Z',
      },
    ]);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].feature).toBe('feat-active');
  });
});
