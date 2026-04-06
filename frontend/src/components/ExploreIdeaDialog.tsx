import { useState } from 'react';
import type { GroupConfig, ProjectSummary } from '../types';

type Mode = 'existing' | 'new';

interface Props {
  groups: GroupConfig[];
  projects: ProjectSummary[];
  onClose: () => void;
  onCreated: (result: { session: string; path: string }) => void;
}

export function ExploreIdeaDialog({ groups, projects, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('existing');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!slug) { setError('Idea name is required'); return; }

    setSubmitting(true);
    try {
      const body = mode === 'existing'
        ? { name: slug, description: description.trim(), projectId }
        : { name: slug, description: description.trim(), group: groupId };

      const res = await fetch('/api/explore-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const result = await res.json();
        onCreated({ session: result.session, path: result.path });
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create idea');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProject = projects.find((p) => p.id === projectId);
  const hint = mode === 'existing' && selectedProject
    ? `Creates .sprints/feat-${slug || '...'}/`
    : slug ? `Creates /Volumes/Extreme Pro/${slug}/` : '';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Explore Idea</h2>

        {/* Mode toggle */}
        <div className="template-selector">
          <button
            type="button"
            className={`template-btn${mode === 'existing' ? ' active' : ''}`}
            onClick={() => setMode('existing')}
          >
            Existing Project
          </button>
          <button
            type="button"
            className={`template-btn${mode === 'new' ? ' active' : ''}`}
            onClick={() => setMode('new')}
          >
            New Project
          </button>
        </div>

        {mode === 'existing' && (
          <label>
            Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.id.toUpperCase()} ({p.stack})</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Idea Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={mode === 'existing' ? 'e.g. dark-mode' : 'e.g. ai-newsletter-tool'}
            required
            autoFocus
          />
          {hint && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{hint}</span>}
        </label>

        <label>
          One-line Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you exploring?"
          />
        </label>

        {mode === 'new' && (
          <label>
            Group
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Explore'}
          </button>
        </div>
      </form>
    </div>
  );
}
