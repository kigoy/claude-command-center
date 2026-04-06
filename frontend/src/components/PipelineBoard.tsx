import { AnimatePresence } from 'framer-motion';
import { BoardCard } from './BoardCard';
import type { PhaseColumn } from '../hooks/use-board';
import '../styles/board.css';

interface Props {
  columns: PhaseColumn[];
  doneCount: number;
  showDone: boolean;
  onToggleDone: () => void;
  selectedSprint?: string | null;
  onSelectSprint?: (key: string | null) => void;
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string) => void;
  terminalSnippets?: Map<string, string[]>;
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
  selectedSprint,
  onSelectSprint,
  onOpenTerminal,
  terminalSnippets,
}: Props) {
  return (
    <div className="pipeline-board">
      {columns.map((col) => (
        <div key={col.phase} className="phase-column">
          <div className="phase-column-header">
            <span className="phase-column-title">
              {PHASE_LABELS[col.phase] ?? col.phase}
            </span>
            <span className="phase-column-count">{col.sprints.length}</span>
          </div>
          <div className="phase-column-cards">
            <AnimatePresence mode="popLayout">
              {col.sprints.map((sprint) => {
                const key = `${sprint.projectId}-${sprint.feature}`;
                return (
                  <BoardCard
                    key={key}
                    sprint={sprint}
                    selected={selectedSprint === key}
                    onSelect={() => onSelectSprint?.(selectedSprint === key ? null : key)}
                    onOpenTerminal={onOpenTerminal}
                    terminalSnippet={terminalSnippets?.get(key)}
                  />
                );
              })}
            </AnimatePresence>
            {col.sprints.length === 0 && (
              <div className="phase-column-empty">No sprints</div>
            )}
          </div>
        </div>
      ))}

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
