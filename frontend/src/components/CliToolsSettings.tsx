import { useEffect, useMemo, useState } from 'react';
import type { CliTool, CliToolStatusDetection } from '../types';

interface Props {
  onToolsChanged?: () => void;
}

type Draft = {
  label: string;
  command: string;
  argsText: string;
  sessionPrefix: string;
  promptMode: CliTool['promptMode'];
  promptArgTemplate: string;
  notes: string;
  runningPatterns: string;
  waitingPatterns: string;
  deadPatterns: string;
};

function patternsToText(patterns?: string[]) {
  return (patterns || []).join('\n');
}

function argsToText(args: string[]) {
  return args.join('\n');
}

function parseLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function buildDetection(draft: Draft): CliToolStatusDetection | null {
  const runningPatterns = parseLines(draft.runningPatterns);
  const waitingPatterns = parseLines(draft.waitingPatterns);
  const deadPatterns = parseLines(draft.deadPatterns);
  if (!runningPatterns.length && !waitingPatterns.length && !deadPatterns.length) return null;
  return { runningPatterns, waitingPatterns, deadPatterns };
}

function buildDraft(tool: CliTool): Draft {
  return {
    label: tool.label,
    command: tool.command,
    argsText: argsToText(tool.args),
    sessionPrefix: tool.sessionPrefix,
    promptMode: tool.promptMode,
    promptArgTemplate: tool.promptArgTemplate || '',
    notes: tool.notes || '',
    runningPatterns: patternsToText(tool.statusDetection?.runningPatterns),
    waitingPatterns: patternsToText(tool.statusDetection?.waitingPatterns),
    deadPatterns: patternsToText(tool.statusDetection?.deadPatterns),
  };
}

export function CliToolsSettings({ onToolsChanged }: Props) {
  const [tools, setTools] = useState<CliTool[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [newTool, setNewTool] = useState({
    id: '',
    label: '',
    command: '',
    argsText: '',
    sessionPrefix: '',
  });

  async function refreshTools() {
    try {
      const res = await fetch('/api/cli-tools');
      if (!res.ok) return;
      setTools(await res.json());
    } catch {
      // Ignore.
    }
  }

  useEffect(() => {
    refreshTools();
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
      await refreshTools();
      onToolsChanged?.();
      flash(successMessage);
      return data;
    } catch (err: any) {
      flash(`Error: ${err.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  const toolIds = useMemo(() => tools.map((tool) => tool.id), [tools]);

  return (
    <section className="settings-section">
      <h3>CLI Tools</h3>
      {toast && <div className="settings-toast">{toast}</div>}
      <div className="cli-tools-list">
        {tools.map((tool, index) => (
          <CliToolRow
            key={tool.id}
            tool={tool}
            saving={saving}
            onSave={(draft) => mutate(`/api/cli-tools/${tool.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: draft.label,
                command: draft.command,
                args: parseLines(draft.argsText),
                sessionPrefix: draft.sessionPrefix,
                promptMode: draft.promptMode,
                promptArgTemplate: draft.promptArgTemplate || null,
                notes: draft.notes || null,
                statusDetection: buildDetection(draft),
              }),
            }, `Saved ${tool.id}`)}
            onToggleEnabled={() => mutate(`/api/cli-tools/${tool.id}/enabled`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: !tool.enabled }),
            }, `${tool.enabled ? 'Disabled' : 'Enabled'} ${tool.id}`)}
            onDuplicate={() => mutate(`/api/cli-tools/${tool.id}/duplicate`, {
              method: 'POST',
            }, `Duplicated ${tool.id}`)}
            onMoveUp={index === 0 ? undefined : () => {
              const next = [...toolIds];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              mutate('/api/cli-tools/reorder', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedIds: next }),
              }, `Moved ${tool.id}`);
            }}
            onMoveDown={index === tools.length - 1 ? undefined : () => {
              const next = [...toolIds];
              [next[index], next[index + 1]] = [next[index + 1], next[index]];
              mutate('/api/cli-tools/reorder', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedIds: next }),
              }, `Moved ${tool.id}`);
            }}
          />
        ))}
      </div>

      <div className="cli-tools-new">
        <h4>Add Tool</h4>
        <div className="cli-tool-grid">
          <label className="settings-row">
            <span>ID</span>
            <input value={newTool.id} onChange={(e) => setNewTool((prev) => ({ ...prev, id: e.target.value }))} placeholder="my-cli" />
          </label>
          <label className="settings-row">
            <span>Label</span>
            <input value={newTool.label} onChange={(e) => setNewTool((prev) => ({ ...prev, label: e.target.value }))} placeholder="My CLI" />
          </label>
          <label className="settings-row">
            <span>Command</span>
            <input value={newTool.command} onChange={(e) => setNewTool((prev) => ({ ...prev, command: e.target.value }))} placeholder="my-cli" />
          </label>
          <label className="settings-row">
            <span>Args</span>
            <textarea value={newTool.argsText} onChange={(e) => setNewTool((prev) => ({ ...prev, argsText: e.target.value }))} placeholder="one arg per line" rows={3} />
          </label>
          <label className="settings-row">
            <span>Session Prefix</span>
            <input value={newTool.sessionPrefix} onChange={(e) => setNewTool((prev) => ({ ...prev, sessionPrefix: e.target.value }))} placeholder="tool-" />
          </label>
        </div>
        <button
          className="settings-save-btn"
          disabled={saving}
          onClick={() => mutate('/api/cli-tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newTool.id.trim(),
              label: newTool.label.trim(),
              command: newTool.command.trim(),
              args: parseLines(newTool.argsText),
              sessionPrefix: newTool.sessionPrefix.trim(),
              enabled: true,
              promptMode: 'none',
            }),
          }, `Added ${newTool.id || 'tool'}`).then((result) => {
            if (result) {
              setNewTool({ id: '', label: '', command: '', argsText: '', sessionPrefix: '' });
            }
          })}
        >
          Add Tool
        </button>
      </div>
    </section>
  );
}

function CliToolRow({
  tool,
  saving,
  onSave,
  onToggleEnabled,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: {
  tool: CliTool;
  saving: boolean;
  onSave: (draft: Draft) => void;
  onToggleEnabled: () => void;
  onDuplicate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => buildDraft(tool));

  useEffect(() => {
    setDraft(buildDraft(tool));
  }, [tool]);

  const changed = JSON.stringify(draft) !== JSON.stringify(buildDraft(tool));

  return (
    <div className="cli-tool-card">
      <div className="cli-tool-card-header">
        <div>
          <strong>{tool.label}</strong>
          <span className="cli-tool-meta">{tool.id}</span>
          {!tool.enabled && <span className="cli-tool-state">Disabled</span>}
          {tool.builtIn && <span className="cli-tool-state">Built-in</span>}
        </div>
        <div className="cli-tool-actions">
          <button type="button" onClick={onToggleEnabled} disabled={saving}>
            {tool.enabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" onClick={onDuplicate} disabled={saving}>Duplicate</button>
          <button type="button" onClick={onMoveUp} disabled={saving || !onMoveUp}>↑</button>
          <button type="button" onClick={onMoveDown} disabled={saving || !onMoveDown}>↓</button>
        </div>
      </div>

      <div className="cli-tool-grid">
        <label className="settings-row">
          <span>Label</span>
          <input value={draft.label} onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))} />
        </label>
        <label className="settings-row">
          <span>Command</span>
          <input value={draft.command} onChange={(e) => setDraft((prev) => ({ ...prev, command: e.target.value }))} />
        </label>
        <label className="settings-row">
          <span>Args</span>
          <textarea value={draft.argsText} onChange={(e) => setDraft((prev) => ({ ...prev, argsText: e.target.value }))} rows={3} />
        </label>
        <label className="settings-row">
          <span>Session Prefix</span>
          <input value={draft.sessionPrefix} onChange={(e) => setDraft((prev) => ({ ...prev, sessionPrefix: e.target.value }))} />
        </label>
        <label className="settings-row">
          <span>Prompt Mode</span>
          <select value={draft.promptMode} onChange={(e) => setDraft((prev) => ({ ...prev, promptMode: e.target.value as CliTool['promptMode'] }))}>
            <option value="none">None</option>
            <option value="stdin">stdin</option>
            <option value="arg">arg</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Prompt Arg Template</span>
          <input value={draft.promptArgTemplate} onChange={(e) => setDraft((prev) => ({ ...prev, promptArgTemplate: e.target.value }))} placeholder="--prompt={{prompt}}" />
        </label>
        <label className="settings-row">
          <span>Running Patterns</span>
          <textarea value={draft.runningPatterns} onChange={(e) => setDraft((prev) => ({ ...prev, runningPatterns: e.target.value }))} rows={3} />
        </label>
        <label className="settings-row">
          <span>Waiting Patterns</span>
          <textarea value={draft.waitingPatterns} onChange={(e) => setDraft((prev) => ({ ...prev, waitingPatterns: e.target.value }))} rows={3} />
        </label>
        <label className="settings-row">
          <span>Dead Patterns</span>
          <textarea value={draft.deadPatterns} onChange={(e) => setDraft((prev) => ({ ...prev, deadPatterns: e.target.value }))} rows={3} />
        </label>
        <label className="settings-row">
          <span>Notes</span>
          <textarea value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} rows={2} />
        </label>
      </div>

      {changed && (
        <button className="settings-save-btn" type="button" disabled={saving} onClick={() => onSave(draft)}>
          Save Tool
        </button>
      )}
    </div>
  );
}
