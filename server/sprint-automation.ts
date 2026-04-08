import type { SprintState } from './sprint-state.js';

export function isRecommendedAutomationEnabled(state: SprintState): boolean {
  return state.automation?.mode === 'recommended';
}

export function enableRecommendedAutomation(state: SprintState): SprintState {
  if (isRecommendedAutomationEnabled(state)) return state;
  return {
    ...state,
    automation: {
      ...state.automation,
      mode: 'recommended',
      enabled_at: new Date().toISOString(),
      retro_sent_at: state.automation?.retro_sent_at ?? null,
    },
  };
}

export function disableAutomation(state: SprintState): SprintState {
  return {
    ...state,
    automation: {
      ...state.automation,
      mode: 'manual',
      retro_sent_at: state.automation?.retro_sent_at ?? null,
    },
  };
}

export function markRetroSent(state: SprintState): SprintState {
  return {
    ...state,
    automation: {
      ...state.automation,
      mode: state.automation?.mode ?? 'manual',
      enabled_at: state.automation?.enabled_at,
      retro_sent_at: new Date().toISOString(),
    },
  };
}
