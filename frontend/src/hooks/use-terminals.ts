import { useState, useCallback, useRef } from 'react';
import type { OpenTerminal } from '../components/Sidebar';
import type { DashboardData, TmuxSession } from '../types';

interface UseTerminalsOptions {
  data: DashboardData | null;
  /** Called after a terminal is activated (opened or focused). */
  onActivate?: () => void;
}

interface UseTerminalsReturn {
  activeTerminalId: string | null;
  setActiveTerminalId: (id: string | null) => void;
  openTerminals: OpenTerminal[];
  unreadSessions: Set<string>;
  openTerminalForSession: (session: TmuxSession) => Promise<void>;
  openTerminalByTmuxName: (tmuxName: string, cwd: string) => Promise<void>;
  openTerminalForSprint: (name: string, cwd: string, tmuxSession?: string) => Promise<void>;
  handleTerminalActivity: (sessionId: string) => void;
}

/**
 * Manages terminal lifecycle: open, focus, unread indicators, and dedup.
 * Accepts DashboardData for project path resolution and an optional
 * onActivate callback fired whenever a terminal becomes active.
 */
export function useTerminals({ data, onActivate }: UseTerminalsOptions): UseTerminalsReturn {
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [openTerminals, setOpenTerminals] = useState<OpenTerminal[]>([]);
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const openingTerminals = useRef(new Set<string>());

  const openTerminalForSession = useCallback(async (session: TmuxSession) => {
    const existing = openTerminals.find((t) => t.tmuxName === session.sessionName);
    if (existing) {
      setActiveTerminalId(existing.id);
      setUnreadSessions((prev) => { const n = new Set(prev); n.delete(existing.id); return n; });
      onActivate?.();
      return;
    }
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
        onActivate?.();
      }
    } catch { /* ignore */ } finally {
      openingTerminals.current.delete(session.sessionName);
    }
  }, [openTerminals, data, onActivate]);

  const openTerminalByTmuxName = useCallback(async (tmuxName: string, cwd: string) => {
    const existing = openTerminals.find((t) => t.tmuxName === tmuxName);
    if (existing) { setActiveTerminalId(existing.id); onActivate?.(); return; }
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
        onActivate?.();
      }
    } catch { /* ignore */ } finally {
      openingTerminals.current.delete(tmuxName);
    }
  }, [openTerminals, onActivate]);

  const openTerminalForSprint = useCallback(async (name: string, cwd: string, tmuxSession?: string) => {
    const lookupName = tmuxSession || name;
    const existing = openTerminals.find((t) => t.tmuxName === lookupName);
    if (existing) {
      setActiveTerminalId(existing.id);
      setUnreadSessions((prev) => { const n = new Set(prev); n.delete(existing.id); return n; });
      onActivate?.();
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
        onActivate?.();
      }
    } catch { /* ignore */ } finally {
      openingTerminals.current.delete(lookupName);
    }
  }, [openTerminals, onActivate]);

  const handleTerminalActivity = useCallback((sessionId: string) => {
    if (sessionId !== activeTerminalId) {
      setUnreadSessions((prev) => new Set(prev).add(sessionId));
    }
  }, [activeTerminalId]);

  return {
    activeTerminalId,
    setActiveTerminalId,
    openTerminals,
    unreadSessions,
    openTerminalForSession,
    openTerminalByTmuxName,
    openTerminalForSprint,
    handleTerminalActivity,
  };
}
