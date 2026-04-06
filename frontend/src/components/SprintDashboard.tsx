import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupSection } from './GroupSection';
import { NewSprintDialog } from './NewSprintDialog';
import { AnalyticsTab } from './AnalyticsTab';
import { useSprintSSE } from '../hooks/use-sprint-sse';
import type { DashboardData } from '../types';

export function SprintDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [offline, setOffline] = useState(false);
  const failCount = useRef(0);
  const [newSprintProject, setNewSprintProject] = useState<string | null>(null);
  const [tab, setTab] = useState<'sprints' | 'analytics'>('sprints');
  const [newSkills, setNewSkills] = useState<Array<{ skill: string }>>([]);

  useEffect(() => {
    fetch('/api/skills/new').then((r) => r.json()).then(setNewSkills).catch(() => {});
  }, []);

  const dismissNewSkills = useCallback(() => {
    fetch('/api/skills/new/dismiss', { method: 'POST' }).catch(() => {});
    setNewSkills([]);
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { signal: AbortSignal.timeout(10_000) });
      if (res.status === 401) { navigate('/login'); return; }
      if (res.ok) {
        setData(await res.json());
        failCount.current = 0;
        setOffline(false);
      } else {
        failCount.current++;
      }
    } catch {
      failCount.current++;
    }
    if (failCount.current >= 2) setOffline(true);
  }, [navigate]);

  useEffect(() => {
    fetchDashboard();
    // Slower poll since SSE handles real-time — this is a safety net
    const id = setInterval(fetchDashboard, 60_000);
    const onOnline = () => fetchDashboard();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchDashboard(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchDashboard]);

  // Live SSE updates — merge into current data
  useSprintSSE(useCallback((event) => {
    setData((prev) => {
      if (!prev) return prev;
      const projects = prev.projects.map((p) => {
        if (p.id !== event.projectId) return p;
        const sprints = p.sprints.map((s) =>
          s.feature === event.feature ? { ...s, ...event.sprint } : s,
        );
        // If sprint not found, add it
        const exists = sprints.some((s) => s.feature === event.feature);
        return { ...p, sprints: exists ? sprints : [...sprints, event.sprint] };
      });
      return { ...prev, projects };
    });
  }, []));

  const totalSprints = data?.projects.reduce((n, p) => n + p.sprints.length, 0) ?? 0;
  const totalActive = data?.projects.reduce(
    (n, p) => n + p.sprints.filter((s) => s.phase !== 'COMPLETE').length, 0,
  ) ?? 0;
  const totalBlocked = data?.projects.reduce(
    (n, p) => n + p.sprints.filter((s) => s.blocked).length, 0,
  ) ?? 0;

  // Separate grouped and ungrouped projects
  const groups = data?.groups ?? [];
  const groupedProjectIds = new Set(groups.flatMap((g) => g.projects));
  const ungrouped = data?.projects.filter((p) => !groupedProjectIds.has(p.id)) ?? [];

  return (
    <div className="dashboard dashboard--v2">
      {offline && <div className="offline-banner">Connection lost — retrying...</div>}

      {newSkills.length > 0 && (
        <div className="new-skills-banner">
          <span>New skills available: {newSkills.map((s) => `/${s.skill}`).join(', ')}</span>
          <button className="new-skills-dismiss" onClick={dismissNewSkills}>Dismiss</button>
        </div>
      )}

      <header className="dashboard-header">
        <div className="dashboard-title">
          <h1>SPRINT COMMAND</h1>
          {data && (
            <span className="dashboard-stats">
              {totalActive} active
              {totalBlocked > 0 && <span className="stats-blocked"> · {totalBlocked} blocked</span>}
              {' · '}{totalSprints} total
            </span>
          )}
        </div>
        <div className="dashboard-tabs">
          <button
            className={`dashboard-tab${tab === 'sprints' ? ' dashboard-tab--active' : ''}`}
            onClick={() => setTab('sprints')}
          >Sprints</button>
          <button
            className={`dashboard-tab${tab === 'analytics' ? ' dashboard-tab--active' : ''}`}
            onClick={() => setTab('analytics')}
          >Analytics</button>
        </div>
        <button className="sessions-btn" onClick={() => navigate('/sessions')}>Sessions</button>
      </header>

      {tab === 'analytics' ? (
        <AnalyticsTab />
      ) : (
      <>
      {!data && <p className="empty">Loading...</p>}

      {data && totalSprints === 0 && (
        <p className="empty">
          No active sprints. Run <code>/sprint new name</code> in a project to start one.
        </p>
      )}

      {/* Grouped projects */}
      {groups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          projects={data?.projects ?? []}
          onNewSprint={(id) => setNewSprintProject(id)}
        />
      ))}

      {/* Ungrouped projects under OTHER */}
      {ungrouped.length > 0 && ungrouped.some((p) => p.sprints.length > 0) && (
        <GroupSection
          group={{ id: '_other', label: 'OTHER', projects: ungrouped.map((p) => p.id) }}
          projects={ungrouped}
          onNewSprint={(id) => setNewSprintProject(id)}
        />
      )}

      {/* Recommendation bar */}
      {data?.recommendations && data.recommendations.length > 0 && (
        <div className="recommendation-bar">
          <strong>NEXT UP</strong>
          <div className="recommendation-list">
            {data.recommendations.map((r, i) => (
              <div key={i} className="recommendation-item">
                <span className="recommendation-rank">{i + 1}</span>
                <span className="recommendation-text">{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {newSprintProject !== null && data && (
        <NewSprintDialog
          projects={data.projects.map((p) => ({ id: p.id, path: p.path, stack: p.stack }))}
          defaultProjectId={newSprintProject}
          onClose={() => setNewSprintProject(null)}
          onCreated={() => { setNewSprintProject(null); fetchDashboard(); }}
        />
      )}
    </div>
  );
}
