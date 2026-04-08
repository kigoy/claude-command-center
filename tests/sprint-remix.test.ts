import { describe, expect, it } from 'vitest';
import { buildSprintRemixPayload } from '../server/sprint-remix.js';
import type { SprintState } from '../server/sprint-state.js';

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    feature: 'feat-sample',
    branch: 'main',
    created: '2026-04-08T00:00:00.000Z',
    phase: 'PLAN',
    phase_history: [],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
    ...overrides,
  };
}

describe('sprint-remix', () => {
  it('remixes explore-idea sprints back into Explore Idea defaults', () => {
    const payload = buildSprintRemixPayload(makeState({
      origin: {
        type: 'explore-idea',
        mode: 'existing',
        project_id: 'alpha',
        idea_name: 'sentry-monitor-health',
        description: 'Track repo health in Sprint Command.',
      },
    }), 'alpha');

    expect(payload).toEqual({
      dialog: 'explore-idea',
      defaults: {
        mode: 'existing',
        name: 'sentry-monitor-health',
        description: 'Track repo health in Sprint Command.',
        projectId: 'alpha',
        groupId: '',
      },
    });
  });

  it('falls back new-project explore remixes to existing project mode', () => {
    const payload = buildSprintRemixPayload(makeState({
      origin: {
        type: 'explore-idea',
        mode: 'new',
        project_id: 'beta',
        group_id: 'internal',
        idea_name: 'exploration',
      },
    }), 'beta');

    expect(payload).toEqual({
      dialog: 'explore-idea',
      defaults: {
        mode: 'existing',
        name: 'exploration',
        description: '',
        projectId: 'beta',
        groupId: 'internal',
      },
    });
  });

  it('remixes plain sprints back into New Sprint defaults', () => {
    const payload = buildSprintRemixPayload(makeState({
      origin: {
        type: 'new-sprint',
        project_id: 'alpha',
        feature_name: 'sample',
      },
    }), 'alpha');

    expect(payload).toEqual({
      dialog: 'new-sprint',
      defaults: {
        projectId: 'alpha',
        featureName: 'sample',
      },
    });
  });
});
