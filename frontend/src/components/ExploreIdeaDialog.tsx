import { useState, type FormEvent } from 'react';
import type { GroupConfig } from '../types';

interface Props {
  groups: GroupConfig[];
  onClose: () => void;
  onCreated: (result: { session: string; path: string }) => void;
}

export function ExploreIdeaDialog({ groups, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!slug) { setError('Name is required'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/explore-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: slug, description: description.trim(), group: groupId }),
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

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Explore Idea</h2>

        <label>
          Idea Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ai-newsletter-tool"
            required
            autoFocus
          />
          {slug && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              Creates /Volumes/Extreme Pro/{slug}/
            </span>
          )}
        </label>

        <label>
          One-line Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this idea do?"
          />
        </label>

        <label>
          Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </label>

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
