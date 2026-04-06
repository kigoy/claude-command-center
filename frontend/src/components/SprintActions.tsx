import { useState, useRef, useEffect } from 'react';

interface Props {
  projectId: string;
  feature: string;
  projectPath: string;
  branch: string;
  tmuxSession: string;
  onArchive?: () => void;
}

export function SprintActions({ projectId, feature, branch, tmuxSession, onArchive }: Props) {
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
