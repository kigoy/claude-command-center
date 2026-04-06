import { useState, useEffect, useCallback } from 'react';

interface DirEntry {
  name: string;
  modified: number;
}

interface Props {
  projectId: string;
  currentPath: string;
  onClose: () => void;
  onLinked: () => void;
}

export function LinkFolderDialog({ projectId, currentPath, onClose, onLinked }: Props) {
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [browsePath, setBrowsePath] = useState('/Volumes/Extreme Pro');
  const [selectedPath, setSelectedPath] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDirs = useCallback(async (path: string) => {
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setDirs(data.dirs ?? []);
        setBrowsePath(data.path ?? path);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDirs(browsePath); }, []);

  function navigateTo(dirName: string) {
    const newPath = `${browsePath}/${dirName}`;
    setSelectedPath(newPath);
    fetchDirs(newPath);
  }

  function navigateUp() {
    const parent = browsePath.replace(/\/[^/]+\/?$/, '') || '/Volumes/Extreme Pro';
    fetchDirs(parent);
  }

  const filtered = dirs.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));

  async function handleLink() {
    const path = selectedPath || browsePath;
    if (!path) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/path`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        onLinked();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to link folder');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <h2>Link Folder — {projectId.toUpperCase()}</h2>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Current: <code>{currentPath}</code>
        </p>

        <label>
          Browse
          <input
            placeholder="Filter folders..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>

        <div className="dir-browser">
          <div className="dir-resolved">{browsePath}</div>
          <div className="dir-list">
            <div className="dir-entry" onClick={navigateUp}>..</div>
            {filtered.map((d) => {
              const fullPath = `${browsePath}/${d.name}`;
              const isSelected = selectedPath === fullPath;
              return (
                <div
                  key={d.name}
                  className={`dir-entry${isSelected ? ' dir-entry--selected' : ''}`}
                  onClick={() => navigateTo(d.name)}
                >
                  {d.name}/
                </div>
              );
            })}
            {filtered.length === 0 && <div className="dir-empty">No matching folders</div>}
          </div>
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.25rem' }}>
          Selected: <strong>{selectedPath || browsePath}</strong>
        </p>

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button onClick={handleLink} disabled={submitting}>
            {submitting ? 'Linking...' : 'Link this folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
