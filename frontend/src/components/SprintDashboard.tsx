import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProjectGroup } from './ProjectGroup';
import { NewSprintDialog } from './NewSprintDialog';

interface ChainStatus {
  plan_done: boolean;
  review_done: boolean;
  qa_done: boolean;
  qa_required: boolean;
}

interface SprintSummary {
  feature: string;
  phase: string;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  last_activity: string;
  branch: string;
  tmux_session: string;
  tmux_active: boolean;
  chain_status: ChainStatus;
}

interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  sprints: SprintSummary[];
}

interface Recommendation {
  text: string;
  project: string;
  feature: string;
  phase: string;
  effort_minutes: number;
  score: number;
}

interface DashboardData {
  projects: ProjectSummary[];
  recommendation: string;
  recommendations?: Recommendation[];
}

export function SprintDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [offline, setOffline] = useState(false);
  const failCount = useRef(0);
  const [newSprintProject, setNewSprintProject] = useState<string | null>(null);

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
        <button onClick={() => navigate('/sessions')}>Sessions</button>
      </header>

      {!data && <p className="empty">Loading...</p>}

      {data && totalSprints === 0 && (
        <p className="empty">
          No active sprints. Run <code>/sprint new name</code> in a project to start one.
        </p>
      )}

      {data?.projects.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          onNewSprint={(id) => setNewSprintProject(id)}
          onRefresh={fetchDashboard}
        />
      ))}

      {data?.recommendations && data.recommendations.length > 0 ? (
        <div className="recommendation-bar">
          <strong>RECOMMEND:</strong>
          <ol className="recommendation-list">
            {data.recommendations.map((r, i) => (
              <li key={i} className="recommendation-item">
                <span className="recommendation-text">{r.text}</span>
                <span className="recommendation-effort">~{r.effort_minutes}min</span>
              </li>
            ))}
          </ol>
        </div>
      ) : data?.recommendation ? (
        <div className="recommendation-bar">
          <strong>RECOMMEND:</strong> {data.recommendation}
        </div>
      ) : null}
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
