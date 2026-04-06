import { useState, useEffect, useCallback, type FormEvent } from 'react';
import type { GroupConfig } from '../types';

const STACKS = [
  'python-fastapi-sveltekit',
  'typescript-next',
  'python-django',
  'node-express-react',
  'other',
] as const;

interface DirEntry {
  name: string;
  modified: number;
}

interface Props {
  groups: GroupConfig[];
  existingProjectIds: string[];
  onClose: () => void;
  onCreated: () => void;
}

export function AddProjectDialog({ groups, existingProjectIds, onClose, onCreated }: Props) {
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [selectedDir, setSelectedDir] = useState('');
  const [projectName, setProjectName] = useState('');
  const [stack, setStack] = useState<string>(STACKS[0]);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [hasDeploy, setHasDeploy] = useState(false);
  const [deployUrl, setDeployUrl] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDirs = useCallback(async () => {
    try {
      const res = await fetch('/api/browse?path=/Volumes/Extreme Pro');
      if (res.ok) {
        const data = await res.json();
        setDirs(data.dirs ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDirs(); }, [fetchDirs]);

  function selectFolder(dirName: string) {
    setSelectedDir(`/Volumes/Extreme Pro/${dirName}`);
    if (!projectName) setProjectName(dirName.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  }

  const filtered = dirs.filter((d) => {
    const n = typeof d === 'string' ? d : d.name;
    return n.toLowerCase().includes(filter.toLowerCase());
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!selectedDir || !projectName.trim()) { setError('Select a folder and name'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedDir,
          name: projectName.trim().toLowerCase().replace(/\s+/g, '-'),
          stack,
          group: groupId,
          has_deploy: hasDeploy,
          deploy_url: hasDeploy ? deployUrl.trim() : undefined,
        }),
      });
      if (res.ok) {
        onCreated();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add project');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form className="dialog dialog--wide" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Add Existing Project</h2>

        <label>
          Folder
          <input
            placeholder="Search folders..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>

        <div className="dir-browser">
          <div className="dir-list">
            {filtered.map((d) => {
              const name = typeof d === 'string' ? d : d.name;
              const alreadyAdded = existingProjectIds.includes(name.toLowerCase());
              const isSelected = selectedDir === `/Volumes/Extreme Pro/${name}`;
              return (
                <div
                  key={name}
                  className={`dir-entry${isSelected ? ' dir-entry--selected' : ''}${alreadyAdded ? ' dir-entry--disabled' : ''}`}
                  onClick={() => !alreadyAdded && selectFolder(name)}
                >
                  {name}/
                  {alreadyAdded && <span className="dir-entry-tag">Already added</span>}
                </div>
              );
            })}
            {filtered.length === 0 && <div className="dir-empty">No matching folders</div>}
          </div>
        </div>

        {selectedDir && (
          <>
            <label>
              Project Name
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
            </label>

            <label>
              Stack
              <select value={stack} onChange={(e) => setStack(e.target.value)}>
                {STACKS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label>
              Group
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>

            <label className="checkbox-row">
              <input type="checkbox" checked={hasDeploy} onChange={(e) => setHasDeploy(e.target.checked)} />
              Has deploy
            </label>

            {hasDeploy && (
              <label>
                Deploy URL
                <input value={deployUrl} onChange={(e) => setDeployUrl(e.target.value)} placeholder="https://..." />
              </label>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={submitting || !selectedDir}>
            {submitting ? 'Adding...' : 'Add Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
