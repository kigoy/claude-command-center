import { useState } from 'react';
import { SprintCard } from './SprintCard';
import { LinkFolderDialog } from './LinkFolderDialog';
import type { ProjectSummary } from '../types';

interface Props {
  project: ProjectSummary;
  onNewSprint: (projectId: string) => void;
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string, toolId?: string) => void;
  onProjectLinked?: () => void;
  onDeleteSprint?: (projectId: string, feature: string) => void;
  onRemixSprint?: (projectId: string, feature: string) => void;
}

export function ProjectGroup({ project, onNewSprint, onOpenTerminal, onProjectLinked, onDeleteSprint, onRemixSprint }: Props) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [showLink, setShowLink] = useState(false);

  const active = project.sprints
    .filter((s) => s.phase !== 'COMPLETE')
    .sort((a, b) => {
      if (a.blocked && !b.blocked) return -1;
      if (!a.blocked && b.blocked) return 1;
      return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
    });

  const completed = project.sprints
    .filter((s) => s.phase === 'COMPLETE')
    .sort((a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime());

  const blockedCount = active.filter((s) => s.blocked).length;
  const linked = project.path_exists !== false; // default true for backwards compat

  return (
    <div className={`project-group${!linked ? ' project-group--unlinked' : ''}`}>
      <div className="project-group-header">
        <h2>{project.id.toUpperCase()}</h2>
        <span className="project-stack">{project.stack}</span>
        {linked ? (
          <>
            <span className="project-sprint-count">
              {active.length} active
              {blockedCount > 0 && <span className="project-blocked-count">, {blockedCount} blocked</span>}
              {completed.length > 0 && `, ${completed.length} done`}
            </span>
            <button className="new-sprint-btn" onClick={() => onNewSprint(project.id)}>
              + Sprint
            </button>
          </>
        ) : (
          <button className="link-folder-btn" onClick={() => setShowLink(true)}>
            Link folder
          </button>
        )}
      </div>

      {!linked && (
        <p className="project-empty project-unlinked-hint">
          No folder linked — click "Link folder" to associate a directory
        </p>
      )}

      {linked && active.length === 0 && completed.length === 0 && (
        <p className="project-empty">No sprints</p>
      )}

      {linked && active.length > 0 && (
        <div className="sprint-list">
          {active.map((sprint) => (
            <SprintCard
              key={sprint.feature}
              sprint={sprint}
              projectId={project.id}
              projectPath={project.path}
              onOpenTerminal={onOpenTerminal}
              onDelete={onDeleteSprint}
              onRemix={onRemixSprint}
            />
          ))}
        </div>
      )}

      {linked && completed.length > 0 && (
        <div className="completed-section">
          <button
            className="completed-toggle"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? '▾' : '▸'} {completed.length} completed
          </button>
          {showCompleted && (
            <div className="sprint-list sprint-list--completed">
              {completed.map((sprint) => (
                <SprintCard
                  key={sprint.feature}
                  sprint={sprint}
                  projectId={project.id}
                  projectPath={project.path}
                  onDelete={onDeleteSprint}
                  onRemix={onRemixSprint}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showLink && (
        <LinkFolderDialog
          projectId={project.id}
          currentPath={project.path}
          onClose={() => setShowLink(false)}
          onLinked={() => { setShowLink(false); onProjectLinked?.(); }}
        />
      )}
    </div>
  );
}
