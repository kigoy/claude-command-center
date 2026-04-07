import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { BoardSprint } from '../hooks/use-board';
import { getHealth, getProjectColor, HEALTH_COLORS, nextAction, timeAgo } from '../utils/sprint-health';
import type { Health } from '../utils/sprint-health';

interface Props {
  sprint: BoardSprint;
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string) => void;
  onSelect?: () => void;
  selected?: boolean;
  focused?: boolean;
  terminalSnippet?: string[];
  onAction?: (command: string, toPhase: string) => Promise<void>;
}

interface PhaseAction {
  command: string;
  label: string;
  toPhase: string;
}

/** Returns the next actionable skill command for a sprint phase, or null if none. */
function getPhaseAction(phase: string, qaRequired: boolean): PhaseAction | null {
  switch (phase) {
    case 'BUILD': return { command: '/review', label: '→ /review', toPhase: 'REVIEW' };
    case 'REVIEW': return qaRequired
      ? { command: '/qa', label: '→ /qa', toPhase: 'QA' }
      : { command: '/ship', label: '→ /ship', toPhase: 'SHIP' };
    case 'QA': return { command: '/ship', label: '→ /ship', toPhase: 'SHIP' };
    default: return null;
  }
}

function AtomRing({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.min(completed / total, 1);
  const r = 16;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="atom-ring">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
      <circle
        cx="20" cy="20" r={r} fill="none"
        stroke="#4caf50" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 20 20)"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x="20" y="22" textAnchor="middle" fontSize="9" fill="var(--text)" fontFamily="monospace">
        {completed}/{total}
      </text>
    </svg>
  );
}

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
  return text ? <span className="board-card-time">{text}</span> : null;
}

export function BoardCard({ sprint, onOpenTerminal, onSelect, selected, focused, terminalSnippet, onAction }: Props) {
  const health: Health = getHealth(sprint);
  const healthColor = HEALTH_COLORS[health];
  const projectColor = getProjectColor(sprint.projectId);
  const isActive = sprint.tmux_active;

  // Scroll focused card into view
  const cardRef = useCallback((node: HTMLDivElement | null) => {
    if (node && focused) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focused]);

  const action = getPhaseAction(sprint.phase, sprint.chain_status.qa_required);
  const isShip = action?.toPhase === 'SHIP';
  const [confirmingShip, setConfirmingShip] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-cancel ship confirm after 5s with no second click
  const SHIP_CONFIRM_TIMEOUT_MS = 5_000;
  useEffect(() => {
    if (!confirmingShip) return;
    confirmTimer.current = setTimeout(() => setConfirmingShip(false), SHIP_CONFIRM_TIMEOUT_MS);
    return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); };
  }, [confirmingShip]);

  function handleTerminal(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onOpenTerminal) return;
    const name = `${sprint.projectId}/${sprint.feature}`;
    onOpenTerminal(name, sprint.projectPath, sprint.tmux_session || undefined);
  }

  function handleAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (!action || !onAction || actionPending) return;
    // /ship requires a two-click confirm
    if (isShip && !confirmingShip) {
      setConfirmingShip(true);
      return;
    }
    setConfirmingShip(false);
    setActionPending(true);
    onAction(action.command, action.toPhase).finally(() => setActionPending(false));
  }

  return (
    <motion.div
      ref={cardRef}
      layout
      layoutId={`${sprint.projectId}-${sprint.feature}`}
      className={`board-card board-card--${health}${isActive ? ' board-card--active' : ''}${selected ? ' board-card--selected' : ''}${focused ? ' board-card--focused' : ''}`}
      style={{ borderLeftColor: projectColor }}
      onClick={onSelect}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ layout: { duration: 0.4, type: 'spring', bounce: 0.15 } }}
    >
      {/* Header: project + feature name */}
      <div className="board-card-header">
        <span className="board-card-project" style={{ color: projectColor }}>
          {sprint.projectId}
        </span>
        {sprint.blocked && <span className="board-card-badge board-card-badge--blocked">BLOCKED</span>}
        {isActive && <span className="board-card-badge board-card-badge--live">LIVE</span>}
      </div>

      <h4 className="board-card-feature">{sprint.feature.replace(/^feat-/, '')}</h4>

      {/* Atom ring + info */}
      <div className="board-card-body">
        {sprint.has_atoms && sprint.atoms_total > 0 && (
          <AtomRing completed={sprint.atoms_completed} total={sprint.atoms_total} />
        )}
        <div className="board-card-info">
          <p className="board-card-action">{nextAction(sprint)}</p>
          <div className="board-card-meta">
            <TimeInPhase since={sprint.last_activity} />
            <span className="board-card-ago">{timeAgo(sprint.last_activity)}</span>
          </div>
        </div>
      </div>

      {/* Terminal mini-preview */}
      {terminalSnippet && terminalSnippet.length > 0 && (
        <div className="board-card-terminal">
          {terminalSnippet.map((line, i) => (
            <div key={i} className="board-card-terminal-line">{line}</div>
          ))}
        </div>
      )}

      {/* Phase action button */}
      {action && onAction && (
        <div className="board-card-footer" onClick={(e) => e.stopPropagation()}>
          <button
            className={[
              'board-card-action-btn',
              isShip && confirmingShip ? 'board-card-action-btn--confirm' : '',
              !sprint.tmux_active ? 'board-card-action-btn--disabled' : '',
              actionPending ? 'board-card-action-btn--pending' : '',
            ].filter(Boolean).join(' ')}
            disabled={!sprint.tmux_active || actionPending}
            title={!sprint.tmux_active ? 'Open terminal first' : undefined}
            onClick={handleAction}
          >
            {actionPending ? '…' : confirmingShip ? 'Confirm ship?' : action.label}
          </button>
        </div>
      )}

      {/* Health indicator bar */}
      <div className="board-card-health" style={{ backgroundColor: healthColor }} />

      {/* Terminal button */}
      <div className="board-card-actions">
        <button
          className={`board-card-btn${isActive ? ' board-card-btn--live' : ''}`}
          onClick={handleTerminal}
        >
          {isActive ? '●' : '▶'}
        </button>
      </div>
    </motion.div>
  );
}
