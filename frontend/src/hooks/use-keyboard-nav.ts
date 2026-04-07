import { useState, useEffect, useCallback } from 'react';
import type { PhaseColumn } from './use-board';

interface UseKeyboardNavParams {
  columns: PhaseColumn[];
  totalCardCount: number;
  activeView: string | null;
  activeTerminalId: string | null;
  onOpenTerminal: (name: string, cwd: string, tmuxSession?: string) => void;
  onEscapeTerminal: () => void;
}

interface UseKeyboardNavReturn {
  focusedCardIndex: number | null;
  setFocusedCardIndex: (index: number | null) => void;
}

/**
 * Board-level keyboard navigation: arrow keys move focus across the pipeline
 * columns, Enter opens a terminal, Esc clears focus or exits terminal, Tab
 * cycles through cards sequentially.
 */
export function useKeyboardNav({
  columns,
  totalCardCount,
  activeView,
  activeTerminalId,
  onOpenTerminal,
  onEscapeTerminal,
}: UseKeyboardNavParams): UseKeyboardNavReturn {
  const [focusedCardIndex, setFocusedCardIndex] = useState<number | null>(null);

  useEffect(() => {
    function handleBoardKeys(e: KeyboardEvent) {
      // Only active on board view, not in terminal
      if (activeView !== 'board' || activeTerminalId !== null) {
        if (e.key === 'Escape' && activeTerminalId !== null) {
          e.preventDefault();
          onEscapeTerminal();
        }
        return;
      }
      if (totalCardCount === 0) return;

      function resolve(flat: number) {
        let remaining = flat;
        for (let ci = 0; ci < columns.length; ci++) {
          if (remaining < columns[ci].sprints.length) return { ci, ri: remaining };
          remaining -= columns[ci].sprints.length;
        }
        return { ci: 0, ri: 0 };
      }

      function flatten(ci: number, ri: number): number {
        let idx = 0;
        for (let c = 0; c < ci; c++) idx += columns[c].sprints.length;
        return idx + ri;
      }

      const current = focusedCardIndex ?? -1;

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          if (current < 0) { setFocusedCardIndex(0); return; }
          const { ci, ri } = resolve(current);
          for (let next = ci + 1; next < columns.length; next++) {
            if (columns[next].sprints.length > 0) {
              const row = Math.min(ri, columns[next].sprints.length - 1);
              setFocusedCardIndex(flatten(next, row));
              return;
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (current < 0) { setFocusedCardIndex(0); return; }
          const { ci, ri } = resolve(current);
          for (let prev = ci - 1; prev >= 0; prev--) {
            if (columns[prev].sprints.length > 0) {
              const row = Math.min(ri, columns[prev].sprints.length - 1);
              setFocusedCardIndex(flatten(prev, row));
              return;
            }
          }
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          if (current < 0) { setFocusedCardIndex(0); return; }
          const { ci, ri } = resolve(current);
          if (ri + 1 < columns[ci].sprints.length) {
            setFocusedCardIndex(flatten(ci, ri + 1));
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (current < 0) { setFocusedCardIndex(0); return; }
          const { ci, ri } = resolve(current);
          if (ri - 1 >= 0) {
            setFocusedCardIndex(flatten(ci, ri - 1));
          }
          break;
        }
        case 'Tab': {
          e.preventDefault();
          const next = current < 0 ? 0 : (current + (e.shiftKey ? -1 : 1) + totalCardCount) % totalCardCount;
          setFocusedCardIndex(next);
          break;
        }
        case 'Enter': {
          if (current >= 0) {
            e.preventDefault();
            let idx = current;
            for (const col of columns) {
              if (idx < col.sprints.length) {
                const sprint = col.sprints[idx];
                onOpenTerminal(
                  `${sprint.projectId}/${sprint.feature}`,
                  sprint.projectPath,
                  sprint.tmux_session || undefined,
                );
                break;
              }
              idx -= col.sprints.length;
            }
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setFocusedCardIndex(null);
          break;
        }
        default:
          return;
      }
    }
    document.addEventListener('keydown', handleBoardKeys);
    return () => document.removeEventListener('keydown', handleBoardKeys);
  }, [activeView, activeTerminalId, focusedCardIndex, totalCardCount, columns, onOpenTerminal, onEscapeTerminal]);

  return { focusedCardIndex, setFocusedCardIndex };
}
