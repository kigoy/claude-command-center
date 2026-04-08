import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { BoardSprint } from '../hooks/use-board';
import { getHealth, getProjectColor, HEALTH_COLORS, nextAction, timeAgo } from '../utils/sprint-health';
import type { Health } from '../utils/sprint-health';
import { getAutoAction } from '../utils/auto-action';

interface Props {
  sprint: BoardSprint;
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string, toolId?: string) => void;
  onSelect?: () => void;
  selected?: boolean;
  focused?: boolean;
  terminalSnippet?: string[];
  onAction?: (command: string, toPhase: string) => Promise<void>;
  onAuto?: (projectId: string, feature: string) => Promise<void>;
  onArchive?: (projectId: string, feature: string) => void;
  onDelete?: (projectId: string, feature: string) => void;
  onRemix?: (projectId: string, feature: string) => void;
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

const PHASE_COLORS: Record<string, string> = {
  PLAN: '#9c27b0',
  BUILD: '#2196f3',
  REVIEW: '#ff9800',
  QA: '#e91e63',
  SHIP: '#4caf50',
};

function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

interface PhaseBar {
  phase: string;
  durationMs: number;
  color: string;
  label: string;
  isCurrent: boolean;
}

function buildPhaseBars(
  phaseHistory: Array<{ phase?: string; entered?: string; exited?: string }>,
): PhaseBar[] {
  const now = Date.now();
  return phaseHistory
    .filter((e) => e.phase && e.entered)
    .map((e) => {
      const entered = new Date(e.entered!).getTime();
      if (isNaN(entered)) return null;
      const isCurrent = !e.exited;
      const exited = isCurrent ? now : new Date(e.exited!).getTime();
      if (isNaN(exited)) return null;
      const durationMs = Math.max(0, exited - entered);
      return {
        phase: e.phase!,
        durationMs,
        color: PHASE_COLORS[e.phase!] ?? 'var(--border)',
        label: `${e.phase}: ${formatDuration(durationMs)}`,
        isCurrent,
      } as PhaseBar;
    })
    .filter(Boolean) as PhaseBar[];
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

function BoardCardTimeline({ phaseHistory, created, isComplete }: {
  phaseHistory: Array<{ phase?: string; entered?: string; exited?: string }>;
  created: string;
  isComplete: boolean;
}) {
  const bars = buildPhaseBars(phaseHistory);
  if (bars.length === 0) return null;

  const totalMs = bars.reduce((sum, b) => sum + b.durationMs, 0);
  if (totalMs === 0) return null;

  // Cycle time: created → now (or last exited for COMPLETE)
  const createdMs = new Date(created).getTime();
  let cycleEnd = Date.now();
  if (isComplete) {
    const lastExited = phaseHistory.filter((e) => e.exited).pop();
    if (lastExited?.exited) {
      const t = new Date(lastExited.exited).getTime();
      if (!isNaN(t)) cycleEnd = t;
    }
  }
  const cycleMs = isNaN(createdMs) ? 0 : Math.max(0, cycleEnd - createdMs);

  return (
    <div className="board-card-timeline">
      <div className="board-card-timeline-bars">
        {bars.map((bar, i) => (
          <div
            key={i}
            className={`board-card-timeline-bar${bar.isCurrent ? ' board-card-timeline-bar--active' : ''}`}
            style={{
              width: `${Math.max(4, (bar.durationMs / totalMs) * 100)}%`,
              backgroundColor: bar.color,
            }}
            title={bar.label}
          />
        ))}
      </div>
      <div className="board-card-timeline-legend">
        {bars.map((bar, i) => (
          <span key={i} className="board-card-timeline-phase" style={{ color: bar.color }}>
            {bar.phase}
          </span>
        ))}
        <span className="board-card-timeline-cycle">
          {formatDuration(cycleMs)}
        </span>
      </div>
    </div>
  );
}

export function BoardCard({ sprint, onOpenTerminal, onSelect, selected, focused, terminalSnippet, onAction, onAuto, onArchive, onDelete, onRemix }: Props) {
  const health: Health = getHealth(sprint);
  const healthColor = HEALTH_COLORS[health];
  const projectColor = getProjectColor(sprint.projectId);
  const isActive = sprint.tmux_active;

  // Scroll focused card into view
  const cardRef = useCallback((node: HTMLDivElement | null) => {
    if (node && focused) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focused]);

  const [showTimeline, setShowTimeline] = useState(false);

  const action = getAutoAction(sprint.phase, sprint.chain_status.qa_required);
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
    onOpenTerminal(name, sprint.projectPath, sprint.tmux_session || undefined, sprint.tool_id);
  }

  function handleAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (!action || actionPending) return;
    // /ship requires a two-click confirm
    if (isShip && !confirmingShip) {
      setConfirmingShip(true);
      return;
    }
    setConfirmingShip(false);
    setActionPending(true);
    const run = onAuto
      ? onAuto(sprint.projectId, sprint.feature)
      : onAction
        ? onAction(action.command, action.toPhase)
        : Promise.resolve();
    run.finally(() => setActionPending(false));
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onDelete) return;
    const name = `${sprint.projectId}/${sprint.feature.replace(/^feat-/, '')}`;
    if (!window.confirm(`Delete sprint ${name}? This removes the sprint folder and kills its tmux session if it is running.`)) {
      return;
    }
    onDelete(sprint.projectId, sprint.feature);
  }

  function handleRemix(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onRemix) return;
    const name = `${sprint.projectId}/${sprint.feature.replace(/^feat-/, '')}`;
    if (!window.confirm(`Remix sprint ${name}? This deletes the current sprint and reopens the original creation flow with the same prompt.`)) {
      return;
    }
    onRemix(sprint.projectId, sprint.feature);
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
        {sprint.automation_enabled && <span className="board-card-badge board-card-badge--auto">AUTO</span>}
        {sprint.blocked && <span className="board-card-badge board-card-badge--blocked">BLOCKED</span>}
        {isActive && <span className="board-card-badge board-card-badge--live">LIVE</span>}
      </div>

      <h4 className="board-card-feature">{sprint.feature.replace(/^feat-/, '')}</h4>

      {/* Atom ring + info — click toggles timeline */}
      <div
        className="board-card-body"
        onClick={(e) => { e.stopPropagation(); setShowTimeline((v) => !v); }}
      >
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

      {/* Phase timeline bars */}
      {showTimeline && sprint.phase_history && sprint.phase_history.length > 0 && (
        <BoardCardTimeline
          phaseHistory={sprint.phase_history}
          created={sprint.created}
          isComplete={sprint.phase === 'COMPLETE'}
        />
      )}

      {/* Terminal mini-preview */}
      {terminalSnippet && terminalSnippet.length > 0 && (
        <div className="board-card-terminal">
          {terminalSnippet.map((line, i) => (
            <div key={i} className="board-card-terminal-line">{line}</div>
          ))}
        </div>
      )}

      {/* Phase action button */}
      {action && (onAuto || onAction) && (
        <div className="board-card-footer" onClick={(e) => e.stopPropagation()}>
          <button
            className={[
              'board-card-action-btn',
              isShip && confirmingShip ? 'board-card-action-btn--confirm' : '',
              actionPending ? 'board-card-action-btn--pending' : '',
            ].filter(Boolean).join(' ')}
            disabled={actionPending}
            title={`Auto It: ${action.command}`}
            onClick={handleAction}
          >
            {actionPending ? '…' : confirmingShip ? 'Confirm auto ship?' : action.label}
          </button>
        </div>
      )}

      {/* Archive button (COMPLETE only) */}
      {sprint.phase === 'COMPLETE' && onArchive && (
        <div className="board-card-footer" onClick={(e) => e.stopPropagation()}>
          <button
            className="board-card-archive-btn"
            onClick={() => onArchive(sprint.projectId, sprint.feature)}
          >
            Archive
          </button>
        </div>
      )}

      {(onDelete || onRemix) && (
        <div className="board-card-footer" onClick={(e) => e.stopPropagation()}>
          {onRemix && (
            <button
              className="board-card-remix-btn"
              onClick={handleRemix}
            >
              Remix
            </button>
          )}
          {onDelete && (
            <button
              className="board-card-delete-btn"
              onClick={handleDelete}
            >
              Delete
            </button>
          )}
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
