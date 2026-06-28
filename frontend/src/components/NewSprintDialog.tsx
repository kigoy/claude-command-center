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
  autoCreated: boolean;
  autoError?: string;
}

interface Props {
  projects: ProjectOption[];
  defaultProjectId?: string;
  initialFeatureName?: string;
  toolId: string;
  onClose: () => void;
  onCreated: (result?: SprintCreatedResult) => void;
}

export function NewSprintDialog({ projects, defaultProjectId, initialFeatureName, toolId, onClose, onCreated }: Props) {
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || '');
  const [featureName, setFeatureName] = useState(initialFeatureName || '');
  const [autoCreate, setAutoCreate] = useState(false);
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
        body: JSON.stringify({ projectId, featureName: trimmed, toolId }),
      });

      if (res.ok) {
        const result = await res.json();
        let autoError: string | undefined;

        if (autoCreate) {
          const autoRes = await fetch(`/api/sprints/${result.project}/${result.feature}/auto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!autoRes.ok) {
            const autoData = await autoRes.json().catch(() => ({}));
            autoError = autoData.error || 'Failed to auto-run sprint';
          }
        }

        onCreated({
          ...result,
          autoCreated: autoCreate && !autoError,
          autoError,
        });
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

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoCreate}
            onChange={(e) => setAutoCreate(e.target.checked)}
          />
          Auto Create
        </label>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
          Immediately runs Auto It after the sprint is created.
        </span>

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
