import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TerminalPanel } from './TerminalPanel';
import { GroupSection } from './GroupSection';
import { PipelineBoard } from './PipelineBoard';
import { CommandPalette } from './CommandPalette';
import { NewSprintDialog } from './NewSprintDialog';
import { ExploreIdeaDialog } from './ExploreIdeaDialog';
import { AddProjectDialog } from './AddProjectDialog';
import { BatchCreateOverlay } from './BatchCreateOverlay';
import { AnalyticsTab } from './AnalyticsTab';
import { AlertBanner } from './AlertBanner';
import { SettingsPage } from './SettingsPage';
import { UpdateToast } from './UpdateToast';
import { PendingQuestionsPanel } from './PendingQuestionsPanel';
import { useSprintSSE } from '../hooks/use-sprint-sse';
import { useBoard } from '../hooks/use-board';
import { useTerminals } from '../hooks/use-terminals';
import { useCliTools } from '../hooks/use-cli-tools';
import { useKeyboardNav } from '../hooks/use-keyboard-nav';
import type { DashboardData, PendingQuestion, TmuxSession } from '../types';

type View = 'dashboard' | 'board' | 'analytics' | 'settings';
type NewSprintDraft = { projectId?: string; featureName?: string };
type ExploreIdeaDraft = {
  mode?: 'existing' | 'new';
  name?: string;
  description?: string;
  projectId?: string;
  groupId?: string;
};

export function MissionControl() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<View | null>('board');
  const [data, setData] = useState<DashboardData | null>(null);
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const [newSprintDraft, setNewSprintDraft] = useState<NewSprintDraft | null>(null);
  const [exploreIdeaDraft, setExploreIdeaDraft] = useState<ExploreIdeaDraft | null>(null);
  const [showBatchCreate, setShowBatchCreate] = useState(false);
  const batchCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [selectedSprint, setSelectedSprint] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [terminalSnippets, setTerminalSnippets] = useState<Map<string, string[]>>(new Map());
  const [actionToast, setActionToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const [showPendingQuestions, setShowPendingQuestions] = useState(true);
  const failCount = useRef(0);
  const { tools, selectedToolId, selectedTool, setSelectedToolId, refreshTools } = useCliTools();

  const { columns, allSprints, doneCount, showDone, setShowDone, filter, setFilter, projectIds } = useBoard(data);

  const clearView = useCallback(() => setActiveView(null), []);

  const {
    activeTerminalId, setActiveTerminalId, openTerminals, unreadSessions,
    closeTerminal, openTerminalForSession, openTerminalByTmuxName, openTerminalForSprint, handleTerminalActivity,
  } = useTerminals({ data, onActivate: clearView });

  const totalCards = columns.reduce((n, col) => n + col.sprints.length, 0);

  const handleEscapeTerminal = useCallback(() => {
    setActiveTerminalId(null);
    setActiveView('board');
  }, [setActiveTerminalId]);

  const { focusedCardIndex } = useKeyboardNav({
    columns,
    totalCardCount: totalCards,
    activeView,
    activeTerminalId,
    onOpenTerminal: openTerminalForSprint,
    onEscapeTerminal: handleEscapeTerminal,
  });

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

  const fetchPendingQuestions = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/requests');
      if (!res.ok) return;
      const requests = await res.json() as PendingQuestion[];
      setPendingQuestions(requests);
      if (requests.length > 0) setShowPendingQuestions(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchTmux();
    fetchPendingQuestions();
    const d = setInterval(fetchDashboard, 60_000);
    const t = setInterval(fetchTmux, 10_000);
    const q = setInterval(fetchPendingQuestions, 5_000);
    const refresh = () => { fetchDashboard(); fetchTmux(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(d); clearInterval(t); clearInterval(q);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchDashboard, fetchPendingQuestions, fetchTmux]);

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

  // --- Actions ---

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

  async function deleteJson(url: string) {
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

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

  const handleDeleteSprint = useCallback(async (projectId: string, feature: string) => {
    try {
      await deleteJson(`/api/sprints/${projectId}/${feature}`);
      setActionToast({ msg: `Deleted ${projectId}/${feature.replace(/^feat-/, '')}`, ok: true });
      fetchDashboard();
      fetchTmux();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setActionToast({ msg, ok: false });
    } finally {
      setTimeout(() => setActionToast(null), ACTION_TOAST_DURATION_MS);
    }
  }, [fetchDashboard, fetchTmux]);

  const handleRemixSprint = useCallback(async (projectId: string, feature: string) => {
    try {
      const result = await postJson(`/api/sprints/${projectId}/${feature}/remix`, {});
      const remix = result.remix as {
        dialog: 'new-sprint' | 'explore-idea';
        defaults: Record<string, string>;
      };

      if (remix.dialog === 'new-sprint') {
        setExploreIdeaDraft(null);
        setNewSprintDraft({
          projectId: remix.defaults.projectId,
          featureName: remix.defaults.featureName,
        });
      } else {
        setNewSprintDraft(null);
        setExploreIdeaDraft({
          mode: remix.defaults.mode as 'existing' | 'new',
          name: remix.defaults.name,
          description: remix.defaults.description,
          projectId: remix.defaults.projectId,
          groupId: remix.defaults.groupId,
        });
      }

      setActionToast({ msg: `Remixed ${projectId}/${feature.replace(/^feat-/, '')}`, ok: true });
      fetchDashboard();
      fetchTmux();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Remix failed';
      setActionToast({ msg, ok: false });
    } finally {
      setTimeout(() => setActionToast(null), ACTION_TOAST_DURATION_MS);
    }
  }, [fetchDashboard, fetchTmux]);

  const handlePendingResponse = useCallback(async (requestId: string, response: string) => {
    const res = await fetch('/api/mcp/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, response }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'Failed to send response');
    }
    await fetchPendingQuestions();
    setActionToast({ msg: 'Sent workflow answer', ok: true });
    setTimeout(() => setActionToast(null), ACTION_TOAST_DURATION_MS);
  }, [fetchPendingQuestions]);

  const handleSelectView = useCallback((view: View) => {
    setActiveView(view);
    setActiveTerminalId(null);
  }, [setActiveTerminalId]);

  const handleTerminalClosed = useCallback((sessionId: string) => {
    closeTerminal(sessionId);
    setActiveView('board');
    fetchDashboard();
    fetchTmux();
  }, [closeTerminal, fetchDashboard, fetchTmux]);

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
      {showPendingQuestions && pendingQuestions.length > 0 && (
        <PendingQuestionsPanel
          requests={pendingQuestions}
          onRespond={handlePendingResponse}
          onDismiss={() => setShowPendingQuestions(false)}
        />
      )}

      <Sidebar
        data={data}
        tmuxSessions={tmuxSessions}
        activeView={showingTerminal ? null : activeView}
        activeTerminalId={activeTerminalId}
        openTerminals={openTerminals}
        unreadSessions={unreadSessions}
        cliTools={tools}
        selectedToolId={selectedToolId}
        onSelectTool={setSelectedToolId}
        onSelectView={handleSelectView}
        onSelectSession={openTerminalForSession}
        onNewSprint={(projectId) => setNewSprintDraft({ projectId })}
        onExploreIdea={() => setExploreIdeaDraft({})}
        onAddProject={() => setShowAddProject(true)}
        onBatchCreate={() => setShowBatchCreate(true)}
        batchCreateTriggerRef={batchCreateTriggerRef}
      />

      <main className="mc-content">
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
                    sprint.tool_id,
                  );
                }
              }
            }}
            onOpenTerminal={openTerminalForSprint}
            terminalSnippets={terminalSnippets}
            onAction={handleSprintAction}
            onArchive={handleArchive}
            onDelete={handleDeleteSprint}
            onRemix={handleRemixSprint}
          />
        )}

        {!showingTerminal && activeView === 'dashboard' && (
          <div className="dashboard-content">
            {!data && <p className="empty">Loading...</p>}
            {data && data.projects.reduce((n, p) => n + p.sprints.length, 0) === 0 && (
              <p className="empty">No active sprints. Use <strong>+ Sprint</strong> in the sidebar to start one.</p>
            )}
            {groups.map((g) => (
              <GroupSection key={g.id} group={g} projects={data?.projects ?? []} onNewSprint={(projectId) => setNewSprintDraft({ projectId })} onOpenTerminal={openTerminalForSprint} onProjectLinked={fetchDashboard} onDeleteSprint={handleDeleteSprint} onRemixSprint={handleRemixSprint} />
            ))}
            {ungrouped.length > 0 && ungrouped.some((p) => p.sprints.length > 0) && (
              <GroupSection
                group={{ id: '_other', label: 'OTHER', projects: ungrouped.map((p) => p.id) }}
                projects={ungrouped}
                onNewSprint={(projectId) => setNewSprintDraft({ projectId })}
                onOpenTerminal={openTerminalForSprint}
                onProjectLinked={fetchDashboard}
                onDeleteSprint={handleDeleteSprint}
                onRemixSprint={handleRemixSprint}
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

        {!showingTerminal && activeView === 'analytics' && <AnalyticsTab />}
        {!showingTerminal && activeView === 'settings' && <SettingsPage onToolsChanged={refreshTools} onConfigChanged={fetchDashboard} />}

        {showingTerminal && activeTerminalId !== null && (
          <div className="mc-terminal-header">
            <button className="mc-terminal-back" onClick={handleEscapeTerminal}>Back</button>
            <div className="mc-terminal-meta">
              <strong>{openTerminals.find((term) => term.id === activeTerminalId)?.name || 'Session'}</strong>
              <span className="mc-terminal-tool">
                {openTerminals.find((term) => term.id === activeTerminalId)?.toolLabel || selectedTool?.label || 'CLI'}
              </span>
              <span className="mc-terminal-tool-id">
                {openTerminals.find((term) => term.id === activeTerminalId)?.toolId || selectedToolId}
              </span>
            </div>
          </div>
        )}

        {openTerminals.map((term) => (
          <TerminalPanel
            key={term.id}
            sessionId={term.id}
            visible={showingTerminal && activeTerminalId === term.id}
            onActivity={() => handleTerminalActivity(term.id)}
            onSessionClosed={handleTerminalClosed}
          />
        ))}
      </main>

      {showCommandPalette && (
        <CommandPalette
          sprints={allSprints}
          onOpenTerminal={openTerminalForSprint}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {newSprintDraft !== null && data && (
        <NewSprintDialog
          projects={data.projects.map((p) => ({ id: p.id, path: p.path, stack: p.stack }))}
          defaultProjectId={newSprintDraft.projectId}
          initialFeatureName={newSprintDraft.featureName}
          onClose={() => setNewSprintDraft(null)}
          onCreated={(result) => {
            setNewSprintDraft(null);
            fetchDashboard();
            fetchTmux();
            if (result?.session) {
              const project = data.projects.find((p) => p.id === result.project);
              openTerminalByTmuxName(result.session, project?.path || '/tmp', selectedToolId);
            }
          }}
          toolId={selectedToolId}
        />
      )}
      {exploreIdeaDraft !== null && (
        <ExploreIdeaDialog
          groups={data?.groups ?? []}
          projects={data?.projects ?? []}
          initialMode={exploreIdeaDraft.mode}
          initialName={exploreIdeaDraft.name}
          initialDescription={exploreIdeaDraft.description}
          initialProjectId={exploreIdeaDraft.projectId}
          initialGroupId={exploreIdeaDraft.groupId}
          onClose={() => setExploreIdeaDraft(null)}
          onCreated={(result) => {
            setExploreIdeaDraft(null);
            fetchDashboard();
            fetchTmux();
            if (result?.session) openTerminalByTmuxName(result.session, result.path, selectedToolId);
          }}
          toolId={selectedToolId}
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
      {showBatchCreate && (
        <BatchCreateOverlay
          projects={data?.projects ?? []}
          toolId={selectedToolId}
          onClose={() => {
            setShowBatchCreate(false);
            // Return focus to the trigger button
            batchCreateTriggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
