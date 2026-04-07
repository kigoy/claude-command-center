import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar, type OpenTerminal } from './Sidebar';
import { TerminalPanel } from './TerminalPanel';
import { GroupSection } from './GroupSection';
import { PipelineBoard } from './PipelineBoard';
import { CommandPalette } from './CommandPalette';
import { NewSprintDialog } from './NewSprintDialog';
import { ExploreIdeaDialog } from './ExploreIdeaDialog';
import { AddProjectDialog } from './AddProjectDialog';
import { AnalyticsTab } from './AnalyticsTab';
import { AlertBanner } from './AlertBanner';
import { SettingsPage } from './SettingsPage';
import { UpdateToast } from './UpdateToast';
import { useSprintSSE } from '../hooks/use-sprint-sse';
import { useBoard } from '../hooks/use-board';
import type { DashboardData, TmuxSession } from '../types';

type View = 'dashboard' | 'board' | 'analytics' | 'settings';

export function MissionControl() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<View | null>('board');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [openTerminals, setOpenTerminals] = useState<OpenTerminal[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const [newSprintProject, setNewSprintProject] = useState<string | null>(null);
  const [showExploreIdea, setShowExploreIdea] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [selectedSprint, setSelectedSprint] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [terminalSnippets, setTerminalSnippets] = useState<Map<string, string[]>>(new Map());
  const [actionToast, setActionToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const failCount = useRef(0);
  const openingTerminals = useRef(new Set<string>());

  const { columns, allSprints, doneCount, showDone, setShowDone, filter, setFilter, projectIds } = useBoard(data);
  const [focusedCardIndex, setFocusedCardIndex] = useState<number | null>(null);

  // Total card count across all visible columns (flat index)
  const totalCards = columns.reduce((n, col) => n + col.sprints.length, 0);

  // --- Keyboard navigation ---

  useEffect(() => {
    function handleBoardKeys(e: KeyboardEvent) {
      // Only active on board view, not in terminal
      if (activeView !== 'board' || activeTerminalId !== null) {
        // Esc from terminal returns to board
        if (e.key === 'Escape' && activeTerminalId !== null) {
          e.preventDefault();
          setActiveTerminalId(null);
          setActiveView('board');
        }
        return;
      }
      if (totalCards === 0) return;

      // Resolve flat index to {columnIndex, cardIndexInColumn}
      function resolve(flat: number) {
        let remaining = flat;
        for (let ci = 0; ci < columns.length; ci++) {
          if (remaining < columns[ci].sprints.length) return { ci, ri: remaining };
          remaining -= columns[ci].sprints.length;
        }
        return { ci: 0, ri: 0 };
      }

      // Build flat index from column + row
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
          const next = current < 0 ? 0 : (current + (e.shiftKey ? -1 : 1) + totalCards) % totalCards;
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
                openTerminalForSprint(
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
  }, [activeView, activeTerminalId, focusedCardIndex, totalCards, columns, openTerminalForSprint]);

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
        const sprints = (p.sprints ?? []).map((s) =>
          s.feature === event.feature ? { ...s, ...event.sprint } : s,
        );
        const exists = sprints.some((s) => s.feature === event.feature);
        return { ...p, sprints: exists ? sprints : [...sprints, event.sprint] };
      });
      return { ...prev, projects };
    });
  }, []));

  // SSE for terminal snippets (last 3 lines per active session)
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      es = new EventSource('/api/terminal-snippets');
      es.addEventListener('terminal-snippet', (event) => {
        try {
          const data = JSON.parse(event.data) as { key: string; lines: string[] };
          setTerminalSnippets((prev) => {
            const next = new Map(prev);
            next.set(data.key, data.lines);
            return next;
          });
        } catch { /* ignore */ }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (!unmounted) reconnectTimer = setTimeout(connect, 5000);
      };
    }
    connect();
    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  // Cmd+K command palette
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

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

  const ACTION_TOAST_DURATION_MS = 3_500;

  async function postJson(url: string, body: object) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /** Send a skill command to a sprint's tmux session and advance its phase. */
  const handleSprintAction = useCallback(async (
    projectId: string, feature: string, command: string, toPhase: string,
  ) => {
    try {
      await postJson(`/api/sprints/${projectId}/${feature}/exec`, { command });
      await postJson(`/api/sprints/${projectId}/${feature}/transition`, { to_phase: toPhase });
      const featureShort = feature.replace(/^feat-/, '');
      setActionToast({ msg: `Sent ${command} → ${projectId}/${featureShort}`, ok: true });
      fetchDashboard();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setActionToast({ msg, ok: false });
    } finally {
      setTimeout(() => setActionToast(null), ACTION_TOAST_DURATION_MS);
    }
  }, [fetchDashboard]);

  const handleArchive = useCallback(async (projectId: string, feature: string) => {
    try {
      await postJson(`/api/sprints/${projectId}/${feature}/archive`, {});
      setActionToast({ msg: `Archived ${projectId}/${feature.replace(/^feat-/, '')}`, ok: true });
      fetchDashboard();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Archive failed';
      setActionToast({ msg, ok: false });
    } finally {
      setTimeout(() => setActionToast(null), ACTION_TOAST_DURATION_MS);
    }
  }, [fetchDashboard]);

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
      <AlertBanner />
      {actionToast && (
        <div className={`action-toast action-toast--${actionToast.ok ? 'ok' : 'err'}`}>
          {actionToast.msg}
        </div>
      )}

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
        {/* Pipeline Board view (default) */}
        {!showingTerminal && activeView === 'board' && (
          <PipelineBoard
            columns={columns}
            doneCount={doneCount}
            showDone={showDone}
            onToggleDone={() => setShowDone(!showDone)}
            filter={filter}
            onFilterChange={setFilter}
            projectIds={projectIds}
            focusedIndex={focusedCardIndex}
            selectedSprint={selectedSprint}
            onSelectSprint={(key) => {
              setSelectedSprint(key);
              if (key) {
                const sprint = allSprints.find(
                  (s) => `${s.projectId}-${s.feature}` === key,
                );
                if (sprint) {
                  openTerminalForSprint(
                    `${sprint.projectId}/${sprint.feature}`,
                    sprint.projectPath,
                    sprint.tmux_session || undefined,
                  );
                }
              }
            }}
            onOpenTerminal={openTerminalForSprint}
            terminalSnippets={terminalSnippets}
            onAction={handleSprintAction}
            onArchive={handleArchive}
          />
        )}

        {/* Legacy dashboard view */}
        {!showingTerminal && activeView === 'dashboard' && (
          <div className="dashboard-content">
            {!data && <p className="empty">Loading...</p>}
            {data && data.projects.reduce((n, p) => n + p.sprints.length, 0) === 0 && (
              <p className="empty">No active sprints. Use <strong>+ Sprint</strong> in the sidebar to start one.</p>
            )}
            {groups.map((g) => (
              <GroupSection key={g.id} group={g} projects={data?.projects ?? []} onNewSprint={setNewSprintProject} onOpenTerminal={openTerminalForSprint} onProjectLinked={fetchDashboard} />
            ))}
            {ungrouped.length > 0 && ungrouped.some((p) => p.sprints.length > 0) && (
              <GroupSection
                group={{ id: '_other', label: 'OTHER', projects: ungrouped.map((p) => p.id) }}
                projects={ungrouped}
                onNewSprint={setNewSprintProject}
                onOpenTerminal={openTerminalForSprint}
                onProjectLinked={fetchDashboard}
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
          <SettingsPage />
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

      {/* Command Palette (Cmd+K) */}
      {showCommandPalette && (
        <CommandPalette
          sprints={allSprints}
          onOpenTerminal={openTerminalForSprint}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

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
          projects={data?.projects ?? []}
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
