import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

interface Props {
  sprint: SprintSummary;
  projectId: string;
  projectPath: string;
  onRefresh?: () => void;
}

const PHASE_COLORS: Record<string, string> = {
  PLAN: '#9e9e9e',
  BUILD: '#4caf50',
  REVIEW: '#2196f3',
  QA: '#ff9800',
  SHIP: '#9c27b0',
  COMPLETE: '#607d8b',
};

/** Phase action button config: label, command, and gate check. */
function getPhaseAction(sprint: SprintSummary): {
  label: string;
  command: string | null;  // null = open terminal instead
  disabled: boolean;
  disabledReason: string;
} | null {
  const { phase, chain_status: cs } = sprint;
  switch (phase) {
    case 'PLAN':
      return { label: 'Run Plan', command: '/office-hours', disabled: false, disabledReason: '' };
    case 'BUILD':
      return { label: 'Continue Build', command: null, disabled: false, disabledReason: '' };
    case 'REVIEW':
      return { label: 'Run /review', command: '/review', disabled: false, disabledReason: '' };
    case 'QA':
      if (!cs.review_done) {
        return { label: 'Run /qa', command: '/qa', disabled: true, disabledReason: '/review must run first' };
      }
      return { label: 'Run /qa', command: '/qa', disabled: false, disabledReason: '' };
    case 'SHIP':
      if (!cs.review_done) {
        return { label: 'Run /ship', command: '/ship', disabled: true, disabledReason: '/review must run first' };
      }
      if (cs.qa_required && !cs.qa_done) {
        return { label: 'Run /ship', command: '/ship', disabled: true, disabledReason: '/qa required (has_ui=true)' };
      }
      return { label: 'Run /ship', command: '/ship', disabled: false, disabledReason: '' };
    case 'COMPLETE':
      return null;
    default:
      return null;
  }
}

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
    case 'BUILD':
      if (!sprint.has_atoms) return 'Run /atomize to define atoms';
      return `Continue atom ${sprint.atoms_completed + 1}`;
    case 'REVIEW': return 'Run /review';
    case 'QA': return 'Run /qa';
    case 'SHIP': return 'Open PR';
    case 'COMPLETE': return 'Done';
    default: return sprint.phase;
  }
}

/** Chain status badges showing which gates have been passed. */
function ChainBadges({ status }: { status: ChainStatus }) {
  const gates = [
    { key: 'plan', done: status.plan_done, label: 'P' },
    { key: 'review', done: status.review_done, label: 'R' },
    { key: 'qa', done: status.qa_done, label: 'Q', required: status.qa_required },
  ];

  const relevant = gates.filter((g) => g.done || g.required !== false);
  if (relevant.length === 0) return null;

  return (
    <span className="chain-badges">
      {relevant.map((g) => (
        <span
          key={g.key}
          className={`chain-badge ${g.done ? 'chain-badge--done' : 'chain-badge--pending'}`}
          title={`${g.label === 'P' ? 'Plan' : g.label === 'R' ? 'Review' : 'QA'}: ${g.done ? 'done' : 'pending'}`}
        >
          {g.label}
        </span>
      ))}
    </span>
  );
}

export function SprintCard({ sprint, projectId, projectPath, onRefresh }: Props) {
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const color = PHASE_COLORS[sprint.phase] || '#9e9e9e';
  const action = getPhaseAction(sprint);

  function handleTerminal(e: React.MouseEvent) {
    e.stopPropagation();
    const body: Record<string, string> = {
      name: `${projectId}/${sprint.feature}`,
      cwd: projectPath,
    };
    if (sprint.tmux_active && sprint.tmux_session) {
      body.tmuxSession = sprint.tmux_session;
    }
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((session) => navigate(`/session/${session.id}`))
      .catch(console.error);
  }

  async function handleAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (!action || action.disabled || sending) return;

    // BUILD phase → open terminal
    if (action.command === null) {
      handleTerminal(e);
      return;
    }

    setSending(true);
    setFeedback('');
    try {
      const res = await fetch(`/api/sprints/${projectId}/${sprint.feature}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: action.command }),
      });
      if (res.ok) {
        setFeedback('Sent');
        setTimeout(() => { setFeedback(''); onRefresh?.(); }, 2000);
      } else {
        const data = await res.json();
        setFeedback(data.error || 'Failed');
        setTimeout(() => setFeedback(''), 3000);
      }
    } catch {
      setFeedback('Error');
      setTimeout(() => setFeedback(''), 3000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="sprint-card">
      <div className="sprint-card-header">
        <span className="sprint-phase-badge" style={{ backgroundColor: color }}>
          {sprint.phase}
        </span>
        <h3 className="sprint-feature-name">{sprint.feature}</h3>
        {sprint.blocked && <span className="sprint-blocked-badge">BLOCKED</span>}
        <ChainBadges status={sprint.chain_status} />
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
        {feedback && <span className="sprint-feedback">{feedback}</span>}
        {action && (
          <button
            className={`action-btn${action.disabled ? ' action-btn--disabled' : ''}`}
            onClick={handleAction}
            disabled={action.disabled || sending}
            title={action.disabled ? action.disabledReason : action.label}
          >
            {sending ? '...' : action.label}
          </button>
        )}
        {sprint.phase !== 'COMPLETE' && (
          <button
            className={`terminal-btn${sprint.tmux_active ? ' terminal-btn--active' : ''}`}
            onClick={handleTerminal}
            title={sprint.tmux_active ? `Attach to ${sprint.tmux_session}` : 'Open terminal'}
          >
            Terminal
          </button>
        )}
      </div>
    </div>
  );
}
