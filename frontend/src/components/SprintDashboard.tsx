import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProjectGroup } from './ProjectGroup';

interface SprintSummary {
  feature: string;
  phase: string;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  last_activity: string;
  branch: string;
}

interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  sprints: SprintSummary[];
}

interface DashboardData {
  projects: ProjectSummary[];
  recommendation: string;
}

export function SprintDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [offline, setOffline] = useState(false);
  const failCount = useRef(0);

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
    const id = setInterval(fetchDashboard, 30_000);
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

  const totalSprints = data?.projects.reduce((n, p) => n + p.sprints.length, 0) ?? 0;

  return (
    <div className="dashboard">
      {offline && (
        <div className="offline-banner">Connection lost — retrying...</div>
      )}

      <header className="dashboard-header">
        <h1>SPRINT COMMAND</h1>
        <button onClick={() => navigate('/')}>Sessions</button>
      </header>

      {!data && <p className="empty">Loading...</p>}

      {data && totalSprints === 0 && (
        <p className="empty">
          No active sprints. Run <code>/sprint new name</code> in a project to start one.
        </p>
      )}

      {data?.projects.map((project) => (
        <ProjectGroup key={project.id} project={project} />
      ))}

      {data?.recommendation && (
        <div className="recommendation-bar">
          <strong>RECOMMEND:</strong> {data.recommendation}
        </div>
      )}
    </div>
  );
}
