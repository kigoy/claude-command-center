import { useMemo, useRef, useState } from 'react';
import type { CliTool, DashboardData, GroupConfig, ProjectSummary, TmuxSession } from '../types';

export interface OpenTerminal {
  id: string;
  name: string;
  tmuxName: string;
  toolId: string;
  toolLabel: string;
}

interface Props {
  data: DashboardData | null;
  tmuxSessions: TmuxSession[];
  activeView: 'dashboard' | 'board' | 'analytics' | 'settings' | null;
  activeTerminalId: string | null;
  openTerminals: OpenTerminal[];
  unreadSessions: Set<string>;
  cliTools: CliTool[];
  selectedToolId: string;
  onSelectTool: (toolId: string) => void;
  onSelectView: (view: 'dashboard' | 'board' | 'analytics' | 'settings') => void;
  onSelectSession: (session: TmuxSession) => void;
  onNewSprint: (projectId: string) => void;
  onExploreIdea: () => void;
  onAddProject: () => void;
  onBatchCreate: () => void;
  defaultProjectId?: string;
  batchCreateTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function Sidebar({
  data, tmuxSessions, activeView, activeTerminalId, openTerminals,
  unreadSessions, cliTools, selectedToolId, onSelectTool, onSelectView, onSelectSession, onNewSprint,
  onExploreIdea, onAddProject, onBatchCreate, defaultProjectId, batchCreateTriggerRef,
}: Props) {
  const groups = data?.groups ?? [];
  const projects = data?.projects ?? [];
  const resolvedDefaultProjectId = defaultProjectId ?? projects[0]?.id ?? null;
  // Keep a local ref so we can fall back if caller doesn't provide one
  const localBtnRef = useRef<HTMLButtonElement>(null);
  const btnRef = batchCreateTriggerRef ?? localBtnRef;

  return (
    <aside className="mc-sidebar">
      <div className="mc-sidebar-header">
        <h1 className="mc-sidebar-logo">SPRINT COMMAND</h1>
        <label className="mc-tool-picker">
          <span>CLI</span>
          <select value={selectedToolId} onChange={(e) => onSelectTool(e.target.value)}>
            {cliTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Primary action: Batch Create */}
      <button
        ref={btnRef}
        className="mc-sidebar-btn mc-sidebar-btn--primary"
        onClick={onBatchCreate}
      >
        + Batch Create
      </button>

      {/* Secondary shortcuts */}
      <div className="mc-sidebar-shortcuts">
        <button className="mc-sidebar-shortcut" onClick={onExploreIdea}>
          Explore Idea
        </button>
        <button
          className="mc-sidebar-shortcut"
          onClick={() => {
            if (resolvedDefaultProjectId) onNewSprint(resolvedDefaultProjectId);
          }}
          disabled={!resolvedDefaultProjectId}
        >
          + Sprint
        </button>
      </div>

      <nav className="mc-sidebar-nav">
        <button
          className={`mc-nav-item${activeView === 'board' ? ' mc-nav-item--active' : ''}`}
          onClick={() => onSelectView('board')}
        >
          ⚡ BOARD
        </button>
        <button
          className={`mc-nav-item${activeView === 'dashboard' ? ' mc-nav-item--active' : ''}`}
          onClick={() => onSelectView('dashboard')}
        >
          DASHBOARD
        </button>
      </nav>

      {/* Active Sessions */}
      <div className="mc-sidebar-section">
        <h3 className="mc-section-title">ACTIVE SESSIONS</h3>
        {tmuxSessions.length === 0 && (
          <p className="mc-section-empty">No active sessions</p>
        )}
        {tmuxSessions.map((session) => {
          const linked = openTerminals.find((t) => t.tmuxName === session.sessionName);
          const isActive = linked?.id === activeTerminalId && activeTerminalId !== null;
          const hasUnread = linked ? unreadSessions.has(linked.id) : false;
          return (
            <button
              key={session.sessionName}
              className={`mc-session-item${isActive ? ' mc-session-item--active' : ''}${hasUnread ? ' mc-session-item--unread' : ''}`}
              onClick={() => onSelectSession(session)}
            >
              <span className={`mc-session-dot${session.agentActive ? ' mc-session-dot--live' : ''}`} />
              <span className="mc-session-label">
                {session.projectId} / {session.feature}
              </span>
            </button>
          );
        })}
      </div>

      {/* Groups */}
      <div className="mc-sidebar-section mc-sidebar-section--groups">
        <h3 className="mc-section-title">GROUPS</h3>
        {groups.map((group) => (
          <SidebarGroup
            key={group.id}
            group={group}
            projects={projects}
            onNewSprint={onNewSprint}
          />
        ))}
      </div>

      <ShipCounter projects={projects} />

      <button className="mc-sidebar-btn mc-sidebar-btn--secondary" onClick={onAddProject}>
        + Add Project
      </button>

      <div className="mc-sidebar-footer">
        <button
          className={`mc-nav-item${activeView === 'analytics' ? ' mc-nav-item--active' : ''}`}
          onClick={() => onSelectView('analytics')}
        >
          ANALYTICS
        </button>
        <button
          className={`mc-nav-item${activeView === 'settings' ? ' mc-nav-item--active' : ''}`}
          onClick={() => onSelectView('settings')}
        >
          SETTINGS
        </button>
      </div>
    </aside>
  );
}

function SidebarGroup({ group, projects, onNewSprint }: {
  group: GroupConfig;
  projects: ProjectSummary[];
  onNewSprint: (projectId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const groupProjects = group.projects
    .map((pid) => projects.find((p) => p.id === pid))
    .filter((p): p is ProjectSummary => !!p);

  return (
    <div className="mc-group">
      <button className="mc-group-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="mc-group-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="mc-group-label">{group.label}</span>
      </button>
      {expanded && groupProjects.map((project) => (
        <div key={project.id} className="mc-project-row">
          <span className="mc-project-name">{project.id.toUpperCase()}</span>
          <button
            className="mc-project-sprint-btn"
            onClick={(e) => { e.stopPropagation(); onNewSprint(project.id); }}
            title="New sprint"
          >
            + Sprint
          </button>
        </div>
      ))}
    </div>
  );
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function ShipCounter({ projects }: { projects: ProjectSummary[] }) {
  const { thisWeek, allTime } = useMemo(() => {
    const now = Date.now();
    let week = 0;
    let total = 0;
    for (const project of projects) {
      for (const sprint of project.sprints) {
        if (sprint.phase !== 'COMPLETE') continue;
        total++;
        const activityMs = new Date(sprint.last_activity).getTime();
        if (now - activityMs <= SEVEN_DAYS_MS) {
          week++;
        }
      }
    }
    return { thisWeek: week, allTime: total };
  }, [projects]);

  return (
    <div className="mc-sidebar-section mc-ship-counter">
      <span className="mc-ship-counter-text">
        {thisWeek} shipped this week / {allTime} all-time
      </span>
    </div>
  );
}
