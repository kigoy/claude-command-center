import { useState, useRef, useEffect } from 'react';
import type { SprintHistoryEvent, SprintReviewReport } from '../types';

interface Props {
  projectId: string;
  feature: string;
  projectPath: string;
  branch: string;
  tmuxSession: string;
  onArchive?: () => void;
  onDelete?: () => void;
  onRemix?: () => void;
}

export function SprintActions({ projectId, feature, branch, tmuxSession, onArchive, onDelete, onRemix }: Props) {
  const [open, setOpen] = useState(false);
  const [viewContent, setViewContent] = useState<{ title: string; content: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function viewFile(filename: string) {
    const endpoint = filename === 'ATOMS.md'
      ? `/api/sprints/${projectId}/${feature}/atoms`
      : `/api/sprints/${projectId}/${feature}/state`;
    try {
      const res = await fetch(endpoint);
      const text = filename === 'ATOMS.md' ? await res.text() : JSON.stringify(await res.json(), null, 2);
      setViewContent({ title: filename, content: text });
      setOpen(false);
    } catch {
      setViewContent({ title: filename, content: 'Failed to load' });
      setOpen(false);
    }
  }

  function formatReviewReport(report: SprintReviewReport): string {
    const lines = [
      `Status: ${report.status.toUpperCase()}`,
      `Summary: ${report.summary}`,
      '',
      `Still valid: ${report.still_valid ? 'yes' : 'no'}`,
      `Started: ${report.started ? 'yes' : 'no'}`,
      `State correct: ${report.state_correct ? 'yes' : 'no'}`,
      '',
      'Facts:',
      `- Phase: ${report.facts.phase}`,
      `- Last activity: ${report.facts.last_activity}`,
      `- History entries: ${report.facts.history_entries}`,
      `- Open phase entries: ${report.facts.open_phase_entries}`,
      `- tmux active: ${report.facts.tmux_active ? 'yes' : 'no'}`,
      `- Has atoms: ${report.facts.has_atoms ? 'yes' : 'no'}`,
      `- Atoms total: ${report.facts.atoms_total}`,
      '',
      'Findings:',
    ];

    if (report.findings.length === 0) {
      lines.push('- None');
    } else {
      for (const finding of report.findings) {
        lines.push(`- [${finding.severity.toUpperCase()}] ${finding.message}`);
      }
    }

    return lines.join('\n');
  }

  async function reviewSprint() {
    try {
      const res = await fetch(`/api/sprints/${projectId}/${feature}/review`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to load');
      }
      const report = await res.json() as SprintReviewReport;
      setViewContent({ title: 'Sprint review', content: formatReviewReport(report) });
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load';
      setViewContent({ title: 'Sprint review', content: message });
      setOpen(false);
    }
  }

  function formatHistory(events: SprintHistoryEvent[]): string {
    if (events.length === 0) return 'No history yet.';

    return events.map((event) => {
      const parts = [
        `${event.ts} [${event.kind.toUpperCase()}] ${event.title}`,
        event.phase ? `Phase: ${event.phase}` : '',
        event.detail || '',
      ].filter(Boolean);

      return parts.join('\n');
    }).join('\n\n');
  }

  async function viewHistory() {
    try {
      const res = await fetch(`/api/sprints/${projectId}/${feature}/history`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to load');
      }
      const history = await res.json() as SprintHistoryEvent[];
      setViewContent({ title: 'Sprint history', content: formatHistory(history) });
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load';
      setViewContent({ title: 'Sprint history', content: message });
      setOpen(false);
    }
  }

  function copyBranch() {
    navigator.clipboard.writeText(branch);
    setOpen(false);
  }

  return (
    <div className="sprint-actions" ref={menuRef}>
      <button className="sprint-actions-trigger" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        &#x22EE;
      </button>

      {open && (
        <div className="sprint-actions-menu" onClick={(e) => e.stopPropagation()}>
          {onArchive && <button onClick={() => { onArchive(); setOpen(false); }}>Archive sprint</button>}
          {onRemix && <button onClick={() => { onRemix(); setOpen(false); }}>Remix sprint</button>}
          {onDelete && <button onClick={() => { onDelete(); setOpen(false); }}>Delete sprint</button>}
          <button onClick={reviewSprint}>Review sprint</button>
          <button onClick={viewHistory}>View history</button>
          <button onClick={() => viewFile('ATOMS.md')}>View ATOMS.md</button>
          <button onClick={() => viewFile('STATE.json')}>View STATE.json</button>
          <button onClick={copyBranch}>Copy branch: {branch}</button>
          <button onClick={() => { navigator.clipboard.writeText(tmuxSession); setOpen(false); }}>
            Copy tmux: {tmuxSession}
          </button>
        </div>
      )}

      {viewContent && (
        <div className="dialog-overlay" onClick={() => setViewContent(null)}>
          <div className="dialog sprint-view-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{viewContent.title}</h2>
            <pre className="sprint-view-content">{viewContent.content}</pre>
            <div className="dialog-actions">
              <button onClick={() => setViewContent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
