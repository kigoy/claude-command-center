import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhaseStepper } from './PhaseStepper';
import { SprintTimeline } from './SprintTimeline';
import { SprintActions } from './SprintActions';
import type { SprintSummary, SprintDetail, PhaseHistoryEntry, Phase } from '../types';

interface Props {
  sprint: SprintSummary;
  projectId: string;
  projectPath: string;
}

const HEALTH_COLORS: Record<string, string> = {
  on_track: '#4caf50',
  stale: '#ff9800',
  blocked: '#f44336',
  waiting: '#9e9e9e',
  complete: '#607d8b',
};

function getHealth(sprint: SprintSummary): string {
  if (sprint.phase === 'COMPLETE') return 'complete';
  if (sprint.blocked) return 'blocked';
  const hours = (Date.now() - new Date(sprint.last_activity).getTime()) / 3600000;
  if (hours > 4) return 'stale';
  return 'on_track';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function nextAction(s: SprintSummary): string {
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

/** Live counter showing time in current phase */
function TimeInPhase({ since }: { since: string }) {
  const [text, setText] = useState('');

  useEffect(() => {
    function tick() {
      const ms = Date.now() - new Date(since).getTime();
      if (isNaN(ms) || ms < 0) { setText(''); return; }
      const m = Math.floor(ms / 60000);
      setText(m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
    }
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [since]);

  return text ? <span className="time-in-phase">{text}</span> : null;
}

function PhaseDetailView({ entry }: { entry: PhaseHistoryEntry }) {
  return (
    <div className="phase-detail">
      <strong>{entry.phase}</strong>
      {entry.decisions?.map((d, i) => <p key={i} className="phase-detail-line">{d}</p>)}
      {entry.e2e_gate && <p>E2E: {entry.e2e_gate}</p>}
      {entry.qa_result && <p>QA: {entry.qa_result}</p>}
      {entry.commit && <p>Commit: <code>{entry.commit}</code></p>}
    </div>
  );
}

export function SprintCard({ sprint, projectId, projectPath }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<SprintDetail | null>(null);
  const [pickedPhase, setPickedPhase] = useState<Phase | null>(null);

  const health = getHealth(sprint);
  const borderColor = HEALTH_COLORS[health];

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/sprints/${projectId}/${sprint.feature}/detail`);
      if (res.ok) setDetail(await res.json());
    } catch { /* ignore */ }
  }, [projectId, sprint.feature]);

  // Re-fetch detail when expanded or when phase changes (SSE update)
  useEffect(() => {
    if (expanded) fetchDetail();
  }, [expanded, sprint.phase, fetchDetail]);

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
      .then((r) => r.json())
      .then((s) => navigate(`/session/${s.id}`))
      .catch(console.error);
  }

  const historyForStepper = detail ? detail.phase_history : [];
  const selectedEntry = pickedPhase && detail
    ? detail.phase_history.find((e) => e.phase === pickedPhase)
    : null;

  return (
    <div
      className={`sprint-card sprint-card--v2 sprint-card--${health}`}
      style={{ borderLeftColor: borderColor }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Phase stepper */}
      <PhaseStepper
        currentPhase={sprint.phase}
        phaseHistory={historyForStepper}
        onPhaseClick={(p) => setPickedPhase(pickedPhase === p ? null : p)}
      />

      {/* Main row */}
      <div className="sprint-card-row">
        <div className="sprint-card-left">
          <h3 className="sprint-feature-name" title={sprint.feature}>
            {sprint.feature.replace(/^feat-/, '')}
          </h3>
          {sprint.blocked && <span className="sprint-blocked-badge">BLOCKED</span>}
          {sprint.tmux_active && <span className="sprint-tmux-badge">LIVE</span>}
        </div>

        <div className="sprint-card-center">
          {sprint.has_atoms && sprint.atoms_total > 0 ? (
            <div className="atom-bar">
              <div className="atom-bar-track">
                <div
                  className="atom-bar-fill"
                  style={{ width: `${Math.round((sprint.atoms_completed / sprint.atoms_total) * 100)}%` }}
                />
              </div>
              <span className="atom-bar-label">{sprint.atoms_completed}/{sprint.atoms_total}</span>
            </div>
          ) : (
            <span className="sprint-no-atoms">{!sprint.has_atoms && sprint.phase !== 'PLAN' ? 'No ATOMS.md' : '--'}</span>
          )}
          <p className="sprint-next-action">{nextAction(sprint)}</p>
          {sprint.suggestions && sprint.suggestions.length > 0 && (
            <div className="sprint-suggestions">
              {sprint.suggestions.map((s) => (
                <span key={s} className="suggestion-pill">{s}</span>
              ))}
            </div>
          )}
        </div>

        <div className="sprint-card-right">
          <div className="sprint-phase-pill">{sprint.phase}</div>
          <TimeInPhase since={sprint.last_activity} />
          <span className="sprint-time-ago">{timeAgo(sprint.last_activity)}</span>
        </div>

        <div className="sprint-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`terminal-btn${sprint.tmux_active ? ' terminal-btn--live' : ''}`}
            onClick={handleTerminal}
          >
            {sprint.tmux_active ? '● Terminal' : '▶ Terminal'}
          </button>
          <SprintActions
            projectId={projectId}
            feature={sprint.feature}
            projectPath={projectPath}
            branch={sprint.branch}
            tmuxSession={sprint.tmux_session}
          />
        </div>
      </div>

      {/* Phase detail popup */}
      {selectedEntry && (
        <div className="phase-detail-panel" onClick={(e) => e.stopPropagation()}>
          <PhaseDetailView entry={selectedEntry} />
        </div>
      )}

      {/* Expanded: timeline + learnings */}
      {expanded && detail && (
        <div className="sprint-expanded" onClick={(e) => e.stopPropagation()}>
          <SprintTimeline history={detail.phase_history} />
          {detail.learnings && detail.learnings.length > 0 && (
            <div className="sprint-learnings">
              <h4>Learnings</h4>
              <ul>{detail.learnings.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
