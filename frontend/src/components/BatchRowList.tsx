/**
 * Dense structured list of preflight rows.
 * Blocked rows sort first (severity-first), then launchable by position.
 * Each row shows: project, row kind, normalized name, tool, tmux prefix hint,
 * and inline blocked reason when present.
 */
import type { PreflightRow } from '../hooks/use-batch-create';

interface Props {
  rows: PreflightRow[];
}

export function BatchRowList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="batch-row-list batch-row-list--empty">
        <p className="batch-row-list__empty-text">No rows to preview.</p>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'blocked' ? -1 : 1;
    return a.position - b.position;
  });

  return (
    <ul className="batch-row-list" aria-label="Preflight preview rows">
      {sorted.map((row) => (
        <li
          key={row.position}
          className={`batch-row-item batch-row-item--${row.state}`}
        >
          <span className="batch-row-item__pos" aria-hidden="true">
            {String(row.position + 1).padStart(2, '0')}
          </span>
          <span
            className="batch-row-item__dot"
            aria-label={row.state === 'blocked' ? 'blocked' : 'launchable'}
            title={row.state}
          />
          <div className="batch-row-item__body">
            <div className="batch-row-item__label">{row.label}</div>
            <div className="batch-row-item__meta">
              <span className="batch-row-item__kind">{row.row_kind || '—'}</span>
              {row.tool_id !== 'claude' && (
                <span className="batch-row-item__tool">{row.tool_id}</span>
              )}
              {row.tmux_prefix_hint && (
                <span className="batch-row-item__tmux">{row.tmux_prefix_hint}…</span>
              )}
            </div>
            {row.blocked_reason && (
              <div className="batch-row-item__reason">{row.blocked_reason}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
