import { useState } from 'react';
import { SprintCard } from './SprintCard';

interface ChainStatus {
  plan_done: boolean;
  review_done: boolean;
  qa_done: boolean;
  qa_required: boolean;
}

interface SprintSummary {
  feature: string;
  phase: string;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  last_activity: string;
  branch: string;
  tmux_session: string;
  tmux_active: boolean;
  chain_status: ChainStatus;
}

interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  sprints: SprintSummary[];
}

interface Props {
  project: ProjectSummary;
  onNewSprint: (projectId: string) => void;
  onRefresh: () => void;
}

export function ProjectGroup({ project, onNewSprint, onRefresh }: Props) {
  const [showCompleted, setShowCompleted] = useState(false);

  const active = project.sprints
    .filter((s) => s.phase !== 'COMPLETE')
    .sort((a, b) => {
      // Blocked first, then by last_activity (most recent first)
      if (a.blocked && !b.blocked) return -1;
      if (!a.blocked && b.blocked) return 1;
      return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
    });

  const completed = project.sprints
    .filter((s) => s.phase === 'COMPLETE')
    .sort((a, b) =>
      new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime(),
    );

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

      {active.length === 0 && completed.length === 0 && (
        <p className="project-empty">No sprints</p>
      )}

      {active.length > 0 && (
        <div className="sprint-list">
          {active.map((sprint) => (
            <SprintCard
              key={sprint.feature}
              sprint={sprint}
              projectId={project.id}
              projectPath={project.path}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="completed-section">
          <button
            className="completed-toggle"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? '▾' : '▸'} Completed ({completed.length})
          </button>
          {showCompleted && (
            <div className="sprint-list sprint-list--completed">
              {completed.map((sprint) => (
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
      )}
    </div>
  );
}
