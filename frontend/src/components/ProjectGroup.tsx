import { SprintCard } from './SprintCard';

interface SprintSummary {
  feature: string;
  phase: string;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  last_activity: string;
  branch: string;
}

interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  sprints: SprintSummary[];
}

const PHASE_ORDER: Record<string, number> = {
  BUILD: 1, REVIEW: 2, QA: 3, SHIP: 4, PLAN: 5, COMPLETE: 99,
};

interface Props {
  project: ProjectSummary;
  onNewSprint: (projectId: string) => void;
}

export function ProjectGroup({ project, onNewSprint }: Props) {
  const sorted = [...project.sprints].sort((a, b) => {
    // Blocked first, then by phase priority
    if (a.blocked && !b.blocked) return -1;
    if (!a.blocked && b.blocked) return 1;
    return (PHASE_ORDER[a.phase] ?? 50) - (PHASE_ORDER[b.phase] ?? 50);
  });

  return (
    <div className="project-group">
      <div className="project-group-header">
        <h2>{project.id.toUpperCase()}</h2>
        <span className="project-stack">{project.stack}</span>
        <button
          className="new-sprint-btn"
          onClick={() => onNewSprint(project.id)}
        >
          + Sprint
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="project-empty">No active sprints</p>
      ) : (
        <div className="sprint-list">
          {sorted.map((sprint) => (
            <SprintCard
              key={sprint.feature}
              sprint={sprint}
              projectId={project.id}
              projectPath={project.path}
            />
          ))}
        </div>
      )}
    </div>
  );
}
