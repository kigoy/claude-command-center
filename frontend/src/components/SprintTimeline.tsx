import type { PhaseHistoryEntry } from '../types';

interface Props {
  history: PhaseHistoryEntry[];
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function durationStr(entered?: string, exited?: string): string {
  if (!entered || !exited) return '';
  const ms = new Date(exited).getTime() - new Date(entered).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function entrySummary(entry: PhaseHistoryEntry): string {
  const parts: string[] = [];
  if (entry.decisions?.length) parts.push(entry.decisions[0]);
  if (entry.e2e_gate) parts.push(`E2E: ${entry.e2e_gate}`);
  if (entry.qa_result) parts.push(`QA: ${entry.qa_result}`);
  if (entry.commit) parts.push(`commit ${entry.commit}`);
  if (entry.atoms_total != null) parts.push(`${entry.atoms_completed ?? 0}/${entry.atoms_total} atoms`);
  return parts.join(' · ') || '';
}

export function SprintTimeline({ history }: Props) {
  // Show most recent first
  const reversed = [...history].reverse();

  return (
    <div className="sprint-timeline">
      {reversed.map((entry, i) => {
        const phase = entry.phase || 'INIT';
        const time = formatTime(entry.exited || entry.entered);
        const dur = durationStr(entry.entered, entry.exited);
        const summary = entrySummary(entry);
        const isActive = !entry.exited;

        return (
          <div key={i} className={`timeline-entry${isActive ? ' timeline-entry--active' : ''}`}>
            <div className="timeline-dot" />
            <div className="timeline-content">
              <div className="timeline-header">
                <span className="timeline-phase">{phase}</span>
                <span className="timeline-time">{time}</span>
                {dur && <span className="timeline-duration">{dur}</span>}
                {isActive && <span className="timeline-live">LIVE</span>}
              </div>
              {summary && <p className="timeline-summary">{summary}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
