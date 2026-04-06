import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar, type OpenTerminal } from './Sidebar';
import { TerminalPanel } from './TerminalPanel';
import { GroupSection } from './GroupSection';
import { NewSprintDialog } from './NewSprintDialog';
import { ExploreIdeaDialog } from './ExploreIdeaDialog';
import { AddProjectDialog } from './AddProjectDialog';
import { AnalyticsTab } from './AnalyticsTab';
import { UpdateToast } from './UpdateToast';
import { useSprintSSE } from '../hooks/use-sprint-sse';
import type { DashboardData, TmuxSession } from '../types';

type View = 'dashboard' | 'analytics' | 'settings';

export function MissionControl() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<View | null>('dashboard');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [openTerminals, setOpenTerminals] = useState<OpenTerminal[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const [newSprintProject, setNewSprintProject] = useState<string | null>(null);
  const [showExploreIdea, setShowExploreIdea] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [offline, setOffline] = useState(false);
  const failCount = useRef(0);
  const openingTerminals = useRef(new Set<string>()); // in-flight guard for duplicate prevention

  // --- Data fetching ---

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { signal: AbortSignal.timeout(10_000) });
      if (res.status === 401) { navigate('/login'); return; }
      if (res.ok) { setData(await res.json()); failCount.current = 0; setOffline(false); }
      else failCount.current++;
    } catch { failCount.current++; }
    if (failCount.current >= 2) setOffline(true);
  }, [navigate]);

  const fetchTmux = useCallback(async () => {
    try {
      const res = await fetch('/api/tmux-sessions');
      if (res.ok) setTmuxSessions(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchTmux();
    const d = setInterval(fetchDashboard, 60_000);
    const t = setInterval(fetchTmux, 10_000);
    const refresh = () => { fetchDashboard(); fetchTmux(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(d); clearInterval(t);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchDashboard, fetchTmux]);

  // SSE for live sprint updates
  useSprintSSE(useCallback((event) => {
    setData((prev) => {
      if (!prev) return prev;
      const projects = prev.projects.map((p) => {
        if (p.id !== event.projectId) return p;
        const sprints = p.sprints.map((s) =>
          s.feature === event.feature ? { ...s, ...event.sprint } : s,
        );
        const exists = sprints.some((s) => s.feature === event.feature);
        return { ...p, sprints: exists ? sprints : [...sprints, event.sprint] };
      });
      return { ...prev, projects };
    });
  }, []));

  // --- Terminal management ---

  const openTerminalForSession = useCallback(async (session: TmuxSession) => {
    const existing = openTerminals.find((t) => t.tmuxName === session.sessionName);
    if (existing) {
      setActiveTerminalId(existing.id);
      setActiveView(null);
      setUnreadSessions((prev) => { const n = new Set(prev); n.delete(existing.id); return n; });
      return;
    }
    // Prevent duplicate server sessions from rapid clicks
    if (openingTerminals.current.has(session.sessionName)) return;
    openingTerminals.current.add(session.sessionName);
    const project = data?.projects.find((p) => p.id === session.projectId);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: session.sessionName, cwd: project?.path || '/tmp', tmuxSession: session.sessionName }),
      });
      if (res.ok) {
        const s = await res.json();
        setOpenTerminals((prev) => [...prev, { id: s.id, name: `${session.projectId} / ${session.feature}`, tmuxName: session.sessionName }]);
        setActiveTerminalId(s.id);
        setActiveView(null);
      }
    } catch { /* ignore */ } finally {
      openingTerminals.current.delete(session.sessionName);
    }
  }, [openTerminals, data]);

  const openTerminalByTmuxName = useCallback(async (tmuxName: string, cwd: string) => {
    const existing = openTerminals.find((t) => t.tmuxName === tmuxName);
    if (existing) { setActiveTerminalId(existing.id); setActiveView(null); return; }
    if (openingTerminals.current.has(tmuxName)) return;
    openingTerminals.current.add(tmuxName);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tmuxName, cwd, tmuxSession: tmuxName }),
      });
      if (res.ok) {
        const s = await res.json();
        setOpenTerminals((prev) => [...prev, { id: s.id, name: tmuxName, tmuxName }]);
        setActiveTerminalId(s.id);
        setActiveView(null);
      }
    } catch { /* ignore */ } finally {
      openingTerminals.current.delete(tmuxName);
    }
  }, [openTerminals]);

  const handleTerminalActivity = useCallback((sessionId: string) => {
    if (sessionId !== activeTerminalId) {
      setUnreadSessions((prev) => new Set(prev).add(sessionId));
    }
  }, [activeTerminalId]);

  const openTerminalForSprint = useCallback(async (name: string, cwd: string, tmuxSession?: string) => {
    const lookupName = tmuxSession || name;
    const existing = openTerminals.find((t) => t.tmuxName === lookupName);
    if (existing) {
      setActiveTerminalId(existing.id);
      setActiveView(null);
      setUnreadSessions((prev) => { const n = new Set(prev); n.delete(existing.id); return n; });
      return;
    }
    if (openingTerminals.current.has(lookupName)) return;
    openingTerminals.current.add(lookupName);
    try {
      const body: Record<string, string> = { name, cwd };
      if (tmuxSession) body.tmuxSession = tmuxSession;
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const s = await res.json();
        setOpenTerminals((prev) => [...prev, { id: s.id, name, tmuxName: lookupName }]);
        setActiveTerminalId(s.id);
        setActiveView(null);
      }
    } catch { /* ignore */ } finally {
      openingTerminals.current.delete(lookupName);
    }
  }, [openTerminals]);

  const handleSelectView = useCallback((view: View) => {
    setActiveView(view);
    setActiveTerminalId(null);
  }, []);

  // --- Render ---

  const showingTerminal = activeTerminalId !== null;
  const groups = data?.groups ?? [];
  const groupedIds = new Set(groups.flatMap((g) => g.projects));
  const ungrouped = data?.projects.filter((p) => !groupedIds.has(p.id)) ?? [];

  return (
    <div className="mission-control">
      {offline && <div className="offline-banner">Connection lost — retrying...</div>}
      <UpdateToast />

      <Sidebar
        data={data}
        tmuxSessions={tmuxSessions}
        activeView={showingTerminal ? null : activeView}
        activeTerminalId={activeTerminalId}
        openTerminals={openTerminals}
        unreadSessions={unreadSessions}
        onSelectView={handleSelectView}
        onSelectSession={openTerminalForSession}
        onNewSprint={setNewSprintProject}
        onExploreIdea={() => setShowExploreIdea(true)}
        onAddProject={() => setShowAddProject(true)}
      />

      <main className="mc-content">
        {/* Dashboard view */}
        {!showingTerminal && activeView === 'dashboard' && (
          <div className="dashboard-content">
            {!data && <p className="empty">Loading...</p>}
            {data && data.projects.reduce((n, p) => n + p.sprints.length, 0) === 0 && (
              <p className="empty">No active sprints. Use <strong>+ Sprint</strong> in the sidebar to start one.</p>
            )}
            {groups.map((g) => (
              <GroupSection key={g.id} group={g} projects={data?.projects ?? []} onNewSprint={setNewSprintProject} onOpenTerminal={openTerminalForSprint} />
            ))}
            {ungrouped.length > 0 && ungrouped.some((p) => p.sprints.length > 0) && (
              <GroupSection
                group={{ id: '_other', label: 'OTHER', projects: ungrouped.map((p) => p.id) }}
                projects={ungrouped}
                onNewSprint={setNewSprintProject}
                onOpenTerminal={openTerminalForSprint}
              />
            )}
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
          </div>
        )}

        {/* Analytics view */}
        {!showingTerminal && activeView === 'analytics' && <AnalyticsTab />}

        {/* Settings view */}
        {!showingTerminal && activeView === 'settings' && (
          <div className="mc-settings"><h2>Settings</h2><p className="empty">Configuration coming soon.</p></div>
        )}

        {/* Terminal panels — all stay mounted, only active is visible */}
        {openTerminals.map((term) => (
          <TerminalPanel
            key={term.id}
            sessionId={term.id}
            visible={showingTerminal && activeTerminalId === term.id}
            onActivity={() => handleTerminalActivity(term.id)}
          />
        ))}
      </main>

      {/* Modals */}
      {newSprintProject !== null && data && (
        <NewSprintDialog
          projects={data.projects.map((p) => ({ id: p.id, path: p.path, stack: p.stack }))}
          defaultProjectId={newSprintProject}
          onClose={() => setNewSprintProject(null)}
          onCreated={(result) => {
            setNewSprintProject(null);
            fetchDashboard();
            fetchTmux();
            if (result?.session) {
              const project = data.projects.find((p) => p.id === result.project);
              openTerminalByTmuxName(result.session, project?.path || '/tmp');
            }
          }}
        />
      )}
      {showExploreIdea && (
        <ExploreIdeaDialog
          groups={data?.groups ?? []}
          onClose={() => setShowExploreIdea(false)}
          onCreated={(result) => {
            setShowExploreIdea(false);
            fetchDashboard();
            fetchTmux();
            if (result?.session) openTerminalByTmuxName(result.session, result.path);
          }}
        />
      )}
      {showAddProject && (
        <AddProjectDialog
          groups={data?.groups ?? []}
          existingProjectIds={data?.projects.map((p) => p.id) ?? []}
          onClose={() => setShowAddProject(false)}
          onCreated={() => { setShowAddProject(false); fetchDashboard(); }}
        />
      )}
    </div>
  );
}
