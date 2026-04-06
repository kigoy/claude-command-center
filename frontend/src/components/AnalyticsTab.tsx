import { useState, useEffect } from 'react';

interface ProjectAnalytics {
  id: string;
  sprint_count: number;
  atoms_per_sprint: number | null;
  chain_compliance_pct: number;
  avg_time_in_phase: Record<string, number | null>;
}

interface AnalyticsData {
  generated_at: string;
  aggregate: {
    total_sprints: number;
    completed_sprints: number;
    active_sprints: number;
    atoms_per_sprint: number | null;
    chain_compliance_pct: number;
    avg_time_in_phase: Record<string, number | null>;
  };
  projects: ProjectAnalytics[];
}

const PHASE_ORDER = ['PLAN', 'BUILD', 'REVIEW', 'QA', 'SHIP'];

function complianceColor(pct: number): string {
  if (pct >= 80) return '#4caf50';
  if (pct >= 50) return '#ff9800';
  return '#f44336';
}

function formatHours(h: number | null): string {
  if (h === null) return '--';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h}h`;
}

/** Simple bar visualization: filled blocks proportional to max value */
function PhaseBar({ hours, maxHours }: { hours: number | null; maxHours: number }) {
  if (hours === null || maxHours === 0) return <span className="analytics-bar-empty">--</span>;
  const pct = Math.min(100, Math.round((hours / maxHours) * 100));
  return (
    <div className="analytics-bar">
      <div className="analytics-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/analytics', { signal: AbortSignal.timeout(10_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="empty">Failed to load analytics: {error}</p>;
  if (!data) return <p className="empty">Loading analytics...</p>;

  const { aggregate, projects } = data;

  // Find max phase hours for bar scaling
  const phaseHours = PHASE_ORDER.map((p) => aggregate.avg_time_in_phase[p] ?? 0);
  const maxHours = Math.max(...phaseHours, 1);

  return (
    <div className="analytics-tab">
      {/* Summary cards */}
      <div className="analytics-cards">
        <div className="analytics-card">
          <div className="analytics-card-value">{aggregate.total_sprints}</div>
          <div className="analytics-card-label">
            Total Sprints
            <span className="analytics-card-sub">
              {aggregate.active_sprints} active / {aggregate.completed_sprints} done
            </span>
          </div>
        </div>

        <div className="analytics-card">
          <div className="analytics-card-value">
            {aggregate.atoms_per_sprint ?? '--'}
          </div>
          <div className="analytics-card-label">Avg Atoms/Sprint</div>
        </div>

        <div className="analytics-card">
          <div
            className="analytics-card-value"
            style={{ color: complianceColor(aggregate.chain_compliance_pct) }}
          >
            {aggregate.chain_compliance_pct}%
          </div>
          <div className="analytics-card-label">Chain Compliance</div>
        </div>
      </div>

      {/* Time-in-phase table */}
      <h3 className="analytics-section-title">Avg Time in Phase</h3>
      <table className="analytics-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Avg Hours</th>
            <th style={{ width: '50%' }}></th>
          </tr>
        </thead>
        <tbody>
          {PHASE_ORDER.map((phase) => (
            <tr key={phase}>
              <td className="analytics-phase-name">{phase}</td>
              <td className="analytics-phase-hours">
                {formatHours(aggregate.avg_time_in_phase[phase] ?? null)}
              </td>
              <td>
                <PhaseBar
                  hours={aggregate.avg_time_in_phase[phase] ?? null}
                  maxHours={maxHours}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per-project breakdown */}
      <h3 className="analytics-section-title">Per Project</h3>
      <table className="analytics-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Sprints</th>
            <th>Atoms/Sprint</th>
            <th>Compliance</th>
          </tr>
        </thead>
        <tbody>
          {projects
            .filter((p) => p.sprint_count > 0)
            .map((p) => (
              <tr key={p.id}>
                <td className="analytics-project-name">{p.id}</td>
                <td>{p.sprint_count}</td>
                <td>{p.atoms_per_sprint ?? '--'}</td>
                <td style={{ color: complianceColor(p.chain_compliance_pct) }}>
                  {p.chain_compliance_pct}%
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
