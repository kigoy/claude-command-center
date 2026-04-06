import { useState, type FormEvent } from 'react';

interface ProjectOption {
  id: string;
  path: string;
  stack: string;
}

export interface SprintCreatedResult {
  feature: string;
  project: string;
  session: string;
}

interface Props {
  projects: ProjectOption[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreated: (result?: SprintCreatedResult) => void;
}

export function NewSprintDialog({ projects, defaultProjectId, onClose, onCreated }: Props) {
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || '');
  const [featureName, setFeatureName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = featureName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!trimmed) {
      setError('Feature name is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, featureName: trimmed }),
      });

      if (res.ok) {
        const result = await res.json();
        onCreated(result);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create sprint');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>New Sprint</h2>

        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id.toUpperCase()} ({p.stack})
              </option>
            ))}
          </select>
        </label>

        <label>
          Feature Name
          <input
            value={featureName}
            onChange={(e) => setFeatureName(e.target.value)}
            placeholder="e.g. new-sprint-button"
            required
            autoFocus
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
            Creates .sprints/feat-{featureName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || '...'}
          </span>
        </label>

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Sprint'}
          </button>
        </div>
      </form>
    </div>
  );
}
