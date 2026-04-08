import { describe, expect, it } from 'vitest';
import { disableAutomation, enableRecommendedAutomation, isRecommendedAutomationEnabled, markRetroSent } from '../server/sprint-automation.js';
import type { SprintState } from '../server/sprint-state.js';

function makeState(): SprintState {
  return {
    feature: 'feat-demo',
    branch: 'main',
    created: '2026-04-08T00:00:00.000Z',
    phase: 'PLAN',
    phase_history: [],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
  };
}

describe('sprint automation', () => {
  it('enables recommended automation', () => {
    const state = enableRecommendedAutomation(makeState());
    expect(isRecommendedAutomationEnabled(state)).toBe(true);
    expect(state.automation?.enabled_at).toBeTruthy();
  });

  it('can disable automation', () => {
    const state = disableAutomation(enableRecommendedAutomation(makeState()));
    expect(isRecommendedAutomationEnabled(state)).toBe(false);
    expect(state.automation?.mode).toBe('manual');
  });

  it('marks retro as sent', () => {
    const state = markRetroSent(enableRecommendedAutomation(makeState()));
    expect(state.automation?.retro_sent_at).toBeTruthy();
  });
});
