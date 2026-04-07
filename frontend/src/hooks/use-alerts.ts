import { useState, useEffect, useCallback } from 'react';

export interface Alert {
  type: string;
  message: string;
  sprintKey: string;
  severity: string;
  source: string;
  timestamp: string;
}

const DISMISSED_KEY = 'sprint-alerts-dismissed';

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveDismissed(dismissed: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

export function useAlerts(pollIntervalMs = 60_000) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) setAlerts(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchAlerts, pollIntervalMs]);

  const dismiss = useCallback((sprintKey: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(sprintKey);
      saveDismissed(next);
      return next;
    });
  }, []);

  const visible = alerts.filter((a) => !dismissed.has(a.sprintKey));

  return { alerts: visible, dismiss, totalCount: alerts.length };
}
