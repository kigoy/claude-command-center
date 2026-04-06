import type { SprintSummary } from '../types';

export type Health = 'on_track' | 'stale' | 'blocked' | 'waiting' | 'complete';

export const HEALTH_COLORS: Record<Health, string> = {
  on_track: '#4caf50',
  stale: '#ff9800',
  blocked: '#f44336',
  waiting: '#2196f3',
  complete: '#607d8b',
};

// 8 preset project colors, assigned deterministically via hash
const PROJECT_PALETTE = [
  '#6c63ff', '#e91e63', '#00bcd4', '#ff9800',
  '#8bc34a', '#9c27b0', '#009688', '#ff5722',
] as const;

export function getHealth(sprint: SprintSummary): Health {
  if (sprint.phase === 'COMPLETE') return 'complete';
  if (sprint.blocked) return 'blocked';
  const hours = (Date.now() - new Date(sprint.last_activity).getTime()) / 3600000;
  if (hours > 4) return 'stale';
  return 'on_track';
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function nextAction(s: SprintSummary): string {
  if (s.blocked) return `Blocked: ${s.blocked_reason || 'unknown'}`;
  switch (s.phase) {
    case 'PLAN': return 'Continue planning';
    case 'BUILD': return s.atoms_total > 0
      ? `Build atom ${s.atoms_completed + 1}/${s.atoms_total}`
      : s.has_atoms ? 'Start building' : 'Run /atomize';
    case 'REVIEW': return 'Run /review';
    case 'QA': return 'Run /qa';
    case 'SHIP': return 'Ship it';
    case 'COMPLETE': return 'Done';
    default: return s.phase;
  }
}

/** Hash a string to an index in 0..n-1 */
function hashToIndex(str: string, n: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % n;
}

export function getProjectColor(projectId: string): string {
  return PROJECT_PALETTE[hashToIndex(projectId, PROJECT_PALETTE.length)];
}
