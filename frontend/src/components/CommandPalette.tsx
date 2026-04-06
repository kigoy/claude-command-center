import { useState, useEffect, useRef, useCallback } from 'react';
import type { BoardSprint } from '../hooks/use-board';
import { getHealth, getProjectColor } from '../utils/sprint-health';

interface Props {
  sprints: BoardSprint[];
  onOpenTerminal?: (name: string, cwd: string, tmuxSession?: string) => void;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  icon: string;
  title: string;
  description: string;
  action: () => void;
}

const COMMANDS = [
  { pattern: /^blocked$/i, icon: '🚫', title: 'Show blocked sprints' },
  { pattern: /^stale$/i, icon: '⏳', title: 'Show stale sprints' },
  { pattern: /^active$/i, icon: '🟢', title: 'Show active sprints' },
];

export function CommandPalette({ sprints, onOpenTerminal, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items: PaletteItem[] = (() => {
    const q = query.toLowerCase().trim();
    if (!q) {
      // Show all sprints grouped by recency
      return sprints.slice(0, 12).map((s) => ({
        id: `${s.projectId}-${s.feature}`,
        icon: s.tmux_active ? '●' : '▸',
        title: `${s.projectId} / ${s.feature}`,
        description: `${s.phase} — ${getHealth(s)}`,
        action: () => {
          onOpenTerminal?.(
            `${s.projectId}/${s.feature}`,
            s.projectPath,
            s.tmux_session || undefined,
          );
          onClose();
        },
      }));
    }

    // Check built-in commands
    if (q === 'blocked' || q === 'show blocked' || q === 'show me everything blocked') {
      return sprints
        .filter((s) => s.blocked)
        .map((s) => ({
          id: `${s.projectId}-${s.feature}`,
          icon: '🚫',
          title: `${s.projectId} / ${s.feature}`,
          description: s.blocked_reason || 'Blocked',
          action: () => {
            onOpenTerminal?.(
              `${s.projectId}/${s.feature}`,
              s.projectPath,
              s.tmux_session || undefined,
            );
            onClose();
          },
        }));
    }

    if (q === 'stale') {
      return sprints
        .filter((s) => getHealth(s) === 'stale')
        .map((s) => ({
          id: `${s.projectId}-${s.feature}`,
          icon: '⏳',
          title: `${s.projectId} / ${s.feature}`,
          description: `Stale in ${s.phase}`,
          action: () => {
            onOpenTerminal?.(
              `${s.projectId}/${s.feature}`,
              s.projectPath,
              s.tmux_session || undefined,
            );
            onClose();
          },
        }));
    }

    // Fuzzy search on project + feature
    return sprints
      .filter((s) =>
        `${s.projectId} ${s.feature}`.toLowerCase().includes(q) ||
        s.phase.toLowerCase().includes(q),
      )
      .slice(0, 12)
      .map((s) => ({
        id: `${s.projectId}-${s.feature}`,
        icon: s.tmux_active ? '●' : '▸',
        title: `${s.projectId} / ${s.feature}`,
        description: `${s.phase} — ${getHealth(s)}`,
        action: () => {
          onOpenTerminal?.(
            `${s.projectId}/${s.feature}`,
            s.projectPath,
            s.tmux_session || undefined,
          );
          onClose();
        },
      }));
  })();

  // Exec command in tmux session
  const execItems: PaletteItem[] = (() => {
    const q = query.trim();
    const execMatch = q.match(/^run\s+(\/.+?)\s+on\s+(.+)$/i);
    if (!execMatch) return [];
    const [, cmd, target] = execMatch;
    const matched = sprints.filter((s) =>
      `${s.projectId}/${s.feature}`.toLowerCase().includes(target.toLowerCase()),
    );
    return matched.map((s) => ({
      id: `exec-${s.projectId}-${s.feature}`,
      icon: '⚡',
      title: `Run ${cmd} on ${s.projectId}/${s.feature}`,
      description: `Execute in tmux session`,
      action: async () => {
        try {
          await fetch(`/api/sprints/${s.projectId}/${s.feature}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmd }),
          });
        } catch { /* ignore */ }
        onClose();
      },
    }));
  })();

  const allItems = [...execItems, ...items];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && allItems[activeIndex]) {
      e.preventDefault();
      allItems[activeIndex].action();
    }
  }, [allItems, activeIndex, onClose]);

  // Reset active index on query change
  useEffect(() => setActiveIndex(0), [query]);

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          placeholder="Search sprints, run commands..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette-results">
          {allItems.length === 0 && (
            <div className="command-palette-empty">No matching sprints or commands</div>
          )}
          {allItems.map((item, i) => (
            <div
              key={item.id}
              className={`command-palette-item${i === activeIndex ? ' command-palette-item--active' : ''}`}
              onClick={item.action}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="command-palette-item-icon">{item.icon}</span>
              <div className="command-palette-item-text">
                <div className="command-palette-item-title">{item.title}</div>
                <div className="command-palette-item-desc">{item.description}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="command-palette-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
