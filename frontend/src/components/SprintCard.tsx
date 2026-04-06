import { useNavigate } from 'react-router-dom';

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

interface Props {
  sprint: SprintSummary;
  projectId: string;
  projectPath: string;
}

const PHASE_COLORS: Record<string, string> = {
  PLAN: '#9e9e9e',
  BUILD: '#4caf50',
  REVIEW: '#2196f3',
  QA: '#ff9800',
  SHIP: '#9c27b0',
  COMPLETE: '#607d8b',
};

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return <span className="sprint-atoms-text">--</span>;
  const pct = Math.round((completed / total) * 100);
  const filled = Math.round((completed / total) * 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  return (
    <span className="sprint-atoms-text" title={`${pct}% complete`}>
      {bar} {completed}/{total}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  if (isNaN(then)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function nextAction(sprint: SprintSummary): string {
  if (sprint.blocked) return `Blocked: ${sprint.blocked_reason || 'unknown'}`;
  switch (sprint.phase) {
    case 'PLAN': return 'Continue planning';
    case 'BUILD': return `Continue atom ${sprint.atoms_completed + 1}`;
    case 'REVIEW': return 'Run /review';
    case 'QA': return 'Run /qa';
    case 'SHIP': return 'Open PR';
    case 'COMPLETE': return 'Done';
    default: return sprint.phase;
  }
}

export function SprintCard({ sprint, projectId, projectPath }: Props) {
  const navigate = useNavigate();
  const color = PHASE_COLORS[sprint.phase] || '#9e9e9e';

  function handleTerminal(e: React.MouseEvent) {
    e.stopPropagation();
    // Create a new session with cwd set to the project path
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${projectId}/${sprint.feature}`,
        cwd: projectPath,
      }),
    })
      .then((res) => res.json())
      .then((session) => navigate(`/session/${session.id}`))
      .catch(console.error);
  }

  return (
    <div className="sprint-card">
      <div className="sprint-card-header">
        <span
          className="sprint-phase-badge"
          style={{ backgroundColor: color }}
        >
          {sprint.phase}
        </span>
        <h3 className="sprint-feature-name">{sprint.feature}</h3>
        {sprint.blocked && <span className="sprint-blocked-badge">BLOCKED</span>}
      </div>

      <div className="sprint-card-body">
        <div className="sprint-atoms-row">
          <ProgressBar completed={sprint.atoms_completed} total={sprint.atoms_total} />
        </div>
        <p className="sprint-next-action">{nextAction(sprint)}</p>
        <p className="sprint-meta">
          {timeAgo(sprint.last_activity)}
          {sprint.branch !== 'main' && <span> on {sprint.branch}</span>}
        </p>
      </div>

      <div className="sprint-card-actions">
        <button className="terminal-btn" onClick={handleTerminal}>
          Terminal ▶
        </button>
      </div>
    </div>
  );
}
