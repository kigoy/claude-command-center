import { useState } from 'react';
import { ProjectGroup } from './ProjectGroup';
import type { GroupConfig, ProjectSummary } from '../types';

interface Props {
  group: GroupConfig;
  projects: ProjectSummary[];
  onNewSprint: (projectId: string) => void;
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string) => void;
}

export function GroupSection({ group, projects, onNewSprint, onOpenTerminal }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const groupProjects = group.projects
    .map((pid) => projects.find((p) => p.id === pid))
    .filter((p): p is ProjectSummary => p !== undefined);

  const totalActive = groupProjects.reduce(
    (n, p) => n + p.sprints.filter((s) => s.phase !== 'COMPLETE').length, 0,
  );
  const totalBlocked = groupProjects.reduce(
    (n, p) => n + p.sprints.filter((s) => s.blocked).length, 0,
  );

  return (
    <div className="group-section">
      <button className="group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="group-chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="group-label">{group.label}</span>
        <span className="group-stats">
          {totalActive} active sprint{totalActive !== 1 ? 's' : ''}
          {totalBlocked > 0 && <span className="group-blocked">, {totalBlocked} blocked</span>}
        </span>
      </button>

      {!collapsed && (
        <div className="group-projects">
          {groupProjects.map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              onNewSprint={onNewSprint}
              onOpenTerminal={onOpenTerminal}
            />
          ))}
        </div>
      )}
    </div>
  );
}
