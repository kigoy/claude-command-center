import { AnimatePresence } from 'framer-motion';
import { BoardCard } from './BoardCard';
import type { PhaseColumn } from '../hooks/use-board';
import '../styles/board.css';

interface Props {
  columns: PhaseColumn[];
  doneCount: number;
  showDone: boolean;
  onToggleDone: () => void;
  focusedIndex?: number | null;
  selectedSprint?: string | null;
  onSelectSprint?: (key: string | null) => void;
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string) => void;
  terminalSnippets?: Map<string, string[]>;
  onAction?: (projectId: string, feature: string, command: string, toPhase: string) => Promise<void>;
}

const PHASE_LABELS: Record<string, string> = {
  PLAN: '📋 PLAN',
  BUILD: '🔨 BUILD',
  REVIEW: '🔍 REVIEW',
  QA: '🧪 QA',
  SHIP: '🚀 SHIP',
  COMPLETE: '✅ DONE',
};

export function PipelineBoard({
  columns,
  doneCount,
  showDone,
  onToggleDone,
  focusedIndex,
  selectedSprint,
  onSelectSprint,
  onOpenTerminal,
  terminalSnippets,
  onAction,
}: Props) {
  // Build a running offset so each column knows its flat-index start
  let flatOffset = 0;

  return (
    <div className="pipeline-board">
      {columns.map((col) => {
        const colOffset = flatOffset;
        flatOffset += col.sprints.length;
        return (
        <div key={col.phase} className="phase-column">
          <div className="phase-column-header">
            <span className="phase-column-title">
              {PHASE_LABELS[col.phase] ?? col.phase}
            </span>
            <span className="phase-column-count">{col.sprints.length}</span>
          </div>
          <div className="phase-column-cards">
            <AnimatePresence mode="popLayout">
              {col.sprints.map((sprint, i) => {
                const key = `${sprint.projectId}-${sprint.feature}`;
                const isFocused = focusedIndex != null && focusedIndex === colOffset + i;
                return (
                  <BoardCard
                    key={key}
                    sprint={sprint}
                    selected={selectedSprint === key}
                    focused={isFocused}
                    onSelect={() => onSelectSprint?.(selectedSprint === key ? null : key)}
                    onOpenTerminal={onOpenTerminal}
                    terminalSnippet={terminalSnippets?.get(key)}
                    onAction={onAction
                      ? (cmd, toPhase) => onAction(sprint.projectId, sprint.feature, cmd, toPhase)
                      : undefined}
                  />
                );
              })}
            </AnimatePresence>
            {col.sprints.length === 0 && (
              <div className="phase-column-empty">No sprints</div>
            )}
          </div>
        </div>
        );
      })}

      {/* DONE toggle (shown when COMPLETE column is hidden) */}
      {!showDone && doneCount > 0 && (
        <div className="done-toggle">
          <button className="done-toggle-btn" onClick={onToggleDone}>
            DONE <span className="done-badge">{doneCount}</span>
          </button>
        </div>
      )}
    </div>
  );
}
