import { useEffect, useState } from 'react';

interface ConfigGroup {
  id: string;
  label: string;
  projects: string[];
}

interface ConfigProject {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  default_qa_routing: string;
  groupIds: string[];
}

interface ScanCandidate {
  id: string;
  name: string;
  path: string;
  group?: string;
  alreadyConfigured: boolean;
  configuredProjectId: string | null;
  hasGit: boolean;
  hasClaudeMd: boolean;
  hasSprints: boolean;
}

interface Props {
  onConfigChanged?: () => void;
}

const STACKS = [
  'python-fastapi-sveltekit',
  'typescript-next',
  'python-django',
  'node-express-react',
  'other',
] as const;

export function SprintConfigSettings({ onConfigChanged }: Props) {
  const [projects, setProjects] = useState<ConfigProject[]>([]);
  const [groups, setGroups] = useState<ConfigGroup[]>([]);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[]>([]);
  const [newGroupId, setNewGroupId] = useState('');
  const [newGroupLabel, setNewGroupLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function refreshConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load sprint config');
    const data = await res.json();
    setProjects(data.projects ?? []);
    setGroups(data.groups ?? []);
  }

  useEffect(() => {
    refreshConfig().catch(() => {});
  }, []);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  async function mutate(url: string, init: RequestInit, successMessage: string) {
    setSaving(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed');
      await refreshConfig();
      onConfigChanged?.();
      flash(successMessage);
      return true;
    } catch (err: any) {
      flash(`Error: ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runScan() {
    try {
      const res = await fetch('/api/config/scan');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setScanCandidates(data.candidates ?? []);
      flash(`Found ${data.candidates?.length ?? 0} candidates`);
    } catch (err: any) {
      flash(`Error: ${err.message}`);
    }
  }

  return (
    <section className="settings-section">
      <h3>Projects And Groups</h3>
      {toast && <div className="settings-toast">{toast}</div>}

      <div className="settings-subsection">
        <div className="settings-subsection-header">
          <strong>Project Scan</strong>
          <button type="button" className="settings-save-btn" onClick={runScan} disabled={saving}>Scan</button>
        </div>
        <div className="settings-card-list">
          {scanCandidates.length === 0 && <p className="settings-empty">No scan results yet.</p>}
          {scanCandidates.map((candidate) => (
            <div key={candidate.path} className="cli-tool-card">
              <div className="cli-tool-card-header">
                <div>
                  <strong>{candidate.name}</strong>
                  <span className="cli-tool-meta">{candidate.path}</span>
                </div>
                <button
                  type="button"
                  onClick={() => mutate('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      path: candidate.path,
                      name: candidate.id,
                      group: candidate.group,
                      stack: 'other',
                      has_deploy: false,
                    }),
                  }, `Added ${candidate.id}`)}
                  disabled={saving || candidate.alreadyConfigured}
                >
                  {candidate.alreadyConfigured ? `Configured as ${candidate.configuredProjectId}` : 'Add Project'}
                </button>
              </div>
              <div className="settings-badge-row">
                {candidate.group && <span className="cli-tool-state">group: {candidate.group}</span>}
                {candidate.hasGit && <span className="cli-tool-state">git</span>}
                {candidate.hasClaudeMd && <span className="cli-tool-state">CLAUDE.md</span>}
                {candidate.hasSprints && <span className="cli-tool-state">.sprints</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-subsection">
        <div className="settings-subsection-header">
          <strong>Projects</strong>
        </div>
        <div className="settings-card-list">
          {projects.map((project) => (
            <ProjectConfigCard
              key={project.id}
              project={project}
              groups={groups}
              saving={saving}
              onSave={(draft) => mutate(`/api/config/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
              }, `Saved ${project.id}`)}
            />
          ))}
        </div>
      </div>

      <div className="settings-subsection">
        <div className="settings-subsection-header">
          <strong>Groups</strong>
        </div>
        <div className="settings-card-list">
          {groups.map((group) => (
            <GroupConfigCard
              key={group.id}
              group={group}
              projects={projects}
              saving={saving}
              onSave={(draft) => mutate(`/api/config/groups/${group.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
              }, `Saved ${group.id}`)}
            />
          ))}
          <div className="cli-tools-new">
            <h4>Add Group</h4>
            <div className="cli-tool-grid">
              <label className="settings-row">
                <span>ID</span>
                <input value={newGroupId} onChange={(e) => setNewGroupId(e.target.value)} placeholder="portfolio" />
              </label>
              <label className="settings-row">
                <span>Label</span>
                <input value={newGroupLabel} onChange={(e) => setNewGroupLabel(e.target.value)} placeholder="Portfolio" />
              </label>
            </div>
            <button
              type="button"
              className="settings-save-btn"
              disabled={saving}
              onClick={() => mutate('/api/config/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: newGroupId.trim(), label: newGroupLabel.trim() }),
              }, `Added ${newGroupId || 'group'}`).then((ok) => {
                if (ok) {
                  setNewGroupId('');
                  setNewGroupLabel('');
                }
              })}
            >
              Add Group
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProjectConfigCard({
  project,
  groups,
  saving,
  onSave,
}: {
  project: ConfigProject;
  groups: ConfigGroup[];
  saving: boolean;
  onSave: (draft: ConfigProject) => void;
}) {
  const [draft, setDraft] = useState(project);
  useEffect(() => setDraft(project), [project]);
  const changed = JSON.stringify(draft) !== JSON.stringify(project);

  return (
    <div className="cli-tool-card">
      <div className="cli-tool-card-header">
        <div>
          <strong>{project.id}</strong>
          <span className="cli-tool-meta">{project.path}</span>
        </div>
        {changed && <button type="button" className="settings-save-btn" onClick={() => onSave(draft)} disabled={saving}>Save</button>}
      </div>
      <div className="cli-tool-grid">
        <label className="settings-row"><span>Path</span><input value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} /></label>
        <label className="settings-row"><span>Stack</span><select value={draft.stack} onChange={(e) => setDraft({ ...draft, stack: e.target.value })}>{STACKS.map((stack) => <option key={stack} value={stack}>{stack}</option>)}</select></label>
        <label className="settings-row"><span>QA Routing</span><input value={draft.default_qa_routing} onChange={(e) => setDraft({ ...draft, default_qa_routing: e.target.value })} /></label>
        <label className="settings-row settings-row--checkbox"><span>Has Deploy</span><input type="checkbox" checked={draft.has_deploy} onChange={(e) => setDraft({ ...draft, has_deploy: e.target.checked })} /></label>
        <label className="settings-row"><span>Deploy URL</span><input value={draft.deploy_url || ''} onChange={(e) => setDraft({ ...draft, deploy_url: e.target.value })} placeholder="https://..." /></label>
      </div>
      <div className="settings-checklist">
        <span className="settings-checklist-label">Groups</span>
        <div className="settings-checkbox-grid">
          {groups.map((group) => (
            <label key={group.id} className="settings-checkbox-item">
              <input
                type="checkbox"
                checked={draft.groupIds.includes(group.id)}
                onChange={(e) => setDraft({
                  ...draft,
                  groupIds: e.target.checked
                    ? [...draft.groupIds, group.id]
                    : draft.groupIds.filter((id) => id !== group.id),
                })}
              />
              <span>{group.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupConfigCard({
  group,
  projects,
  saving,
  onSave,
}: {
  group: ConfigGroup;
  projects: ConfigProject[];
  saving: boolean;
  onSave: (draft: ConfigGroup) => void;
}) {
  const [draft, setDraft] = useState(group);
  useEffect(() => setDraft(group), [group]);
  const changed = JSON.stringify(draft) !== JSON.stringify(group);

  return (
    <div className="cli-tool-card">
      <div className="cli-tool-card-header">
        <div>
          <strong>{group.label}</strong>
          <span className="cli-tool-meta">{group.id}</span>
        </div>
        {changed && <button type="button" className="settings-save-btn" onClick={() => onSave(draft)} disabled={saving}>Save</button>}
      </div>
      <div className="cli-tool-grid">
        <label className="settings-row"><span>Label</span><input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
      </div>
      <div className="settings-checklist">
        <span className="settings-checklist-label">Projects</span>
        <div className="settings-checkbox-grid">
          {projects.map((project) => (
            <label key={project.id} className="settings-checkbox-item">
              <input
                type="checkbox"
                checked={draft.projects.includes(project.id)}
                onChange={(e) => setDraft({
                  ...draft,
                  projects: e.target.checked
                    ? [...draft.projects, project.id]
                    : draft.projects.filter((id) => id !== project.id),
                })}
              />
              <span>{project.id}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
