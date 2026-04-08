import type { SprintState } from './sprint-state.js';

export interface NewSprintRemixPayload {
  dialog: 'new-sprint';
  defaults: {
    projectId: string;
    featureName: string;
  };
}

export interface ExploreIdeaRemixPayload {
  dialog: 'explore-idea';
  defaults: {
    mode: 'existing' | 'new';
    name: string;
    description: string;
    projectId: string;
    groupId: string;
  };
}

export type SprintRemixPayload = NewSprintRemixPayload | ExploreIdeaRemixPayload;

function featureBase(feature: string): string {
  return feature.replace(/^feat-/, '');
}

export function buildSprintRemixPayload(state: SprintState, currentProjectId: string): SprintRemixPayload {
  const origin = state.origin;

  if (origin?.type === 'explore-idea') {
    return {
      dialog: 'explore-idea',
      defaults: {
        mode: origin.mode === 'new' ? 'existing' : (origin.mode || 'existing'),
        name: origin.idea_name || featureBase(state.feature),
        description: origin.description || '',
        projectId: origin.project_id || currentProjectId,
        groupId: origin.group_id || '',
      },
    };
  }

  return {
    dialog: 'new-sprint',
    defaults: {
      projectId: origin?.project_id || currentProjectId,
      featureName: origin?.feature_name || featureBase(state.feature),
    },
  };
}
