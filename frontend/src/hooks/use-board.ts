import { useMemo, useState } from 'react';
import { PHASE_ORDER } from '../types';
import type { DashboardData, SprintSummary } from '../types';
import { getHealth, isStaleSprint } from '../utils/sprint-health';

export interface BoardSprint extends SprintSummary {
  projectId: string;
  projectPath: string;
}

export type PhaseColumn = {
  phase: string;
  sprints: BoardSprint[];
};

/** Sort priority: active first, then by recency, blocked/stale last */
function activityScore(s: BoardSprint): number {
  if (s.blocked) return 4;
  const health = getHealth(s);
  if (health === 'stale') return 3;
  if (health === 'complete') return 5;
  if (s.tmux_active) return 0;
  return 1 + (Date.now() - new Date(s.last_activity).getTime()) / 3600000 / 100;
}

function sortByActivity(a: BoardSprint, b: BoardSprint): number {
  return activityScore(a) - activityScore(b);
}

export type BoardFilter = {
  project?: string;
  health?: string;
};

type BoardVisibilitySprint = Pick<SprintSummary, 'archived' | 'phase' | 'blocked' | 'last_activity'>;

export function isBoardVisibleSprint(
  sprint: BoardVisibilitySprint,
  options: { filterHealth?: string; showDone?: boolean } = {},
): boolean {
  const { filterHealth, showDone = false } = options;
  if (sprint.archived === true && !showDone) return false;
  if (!filterHealth && sprint.phase !== 'COMPLETE' && isStaleSprint(sprint)) return false;
  return true;
}

export function useBoard(data: DashboardData | null) {
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState<BoardFilter>({});

  const allSprints = useMemo<BoardSprint[]>(() => {
    if (!data) return [];
    return data.projects.flatMap((p) =>
      (p.sprints ?? []).map((s) => ({
        ...s,
        projectId: p.id,
        projectPath: p.path,
      })),
    );
  }, [data]);

  const filteredSprints = useMemo(() => {
    return allSprints.filter((s) => {
      if (filter.project && s.projectId !== filter.project) return false;
      if (filter.health && getHealth(s) !== filter.health) return false;
      if (!isBoardVisibleSprint(s, { filterHealth: filter.health, showDone })) return false;
      return true;
    });
  }, [allSprints, filter, showDone]);

  const columns = useMemo<PhaseColumn[]>(() => {
    return PHASE_ORDER.map((phase) => ({
      phase,
      sprints: filteredSprints
        .filter((s) => s.phase === phase)
        .sort(sortByActivity),
    }));
  }, [filteredSprints]);

  const visibleColumns = useMemo(() => {
    if (showDone) return columns;
    return columns.filter((c) => c.phase !== 'COMPLETE');
  }, [columns, showDone]);

  const doneCount = useMemo(() => {
    return columns.find((c) => c.phase === 'COMPLETE')?.sprints.length ?? 0;
  }, [columns]);

  const projectIds = useMemo(() => {
    const ids = new Set(allSprints.map((s) => s.projectId));
    return [...ids].sort();
  }, [allSprints]);

  return { columns: visibleColumns, allSprints, doneCount, showDone, setShowDone, filter, setFilter, projectIds };
}
