import { useState, useEffect } from 'react';

interface Settings {
  NTFY_URL: string;
  NTFY_TOPIC: string;
  NTFY_ENABLED: string;
  BASE_URL: string;
  PORT: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  );

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  async function handleSave(key: keyof Settings, value: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
      setToast('Saved');
      setTimeout(() => setToast(null), 2000);
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <div className="mc-settings"><p className="empty">Loading settings...</p></div>;

  return (
    <div className="mc-settings">
      <h2>Settings</h2>
      {toast && <div className="settings-toast">{toast}</div>}

      <section className="settings-section">
        <h3>Appearance</h3>
        <label className="settings-row">
          <span>Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h3>Notifications</h3>
        <label className="settings-row">
          <span>ntfy Enabled</span>
          <select
            value={settings.NTFY_ENABLED}
            onChange={(e) => handleSave('NTFY_ENABLED', e.target.value)}
            disabled={saving}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <SettingsInput label="ntfy URL" value={settings.NTFY_URL} onSave={(v) => handleSave('NTFY_URL', v)} disabled={saving} />
        <SettingsInput label="ntfy Topic" value={settings.NTFY_TOPIC} onSave={(v) => handleSave('NTFY_TOPIC', v)} disabled={saving} />
        <SettingsInput label="Base URL" value={settings.BASE_URL} onSave={(v) => handleSave('BASE_URL', v)} disabled={saving} placeholder="e.g. http://localhost:3100" />
      </section>

      <section className="settings-section">
        <h3>Server</h3>
        <div className="settings-row">
          <span>Port</span>
          <span className="settings-value">{settings.PORT || '3100'} (restart required to change)</span>
        </div>
      </section>
    </div>
  );
}

function SettingsInput({ label, value, onSave, disabled, placeholder }: {
  label: string; value: string; onSave: (v: string) => void; disabled: boolean; placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const changed = draft !== value;

  return (
    <label className="settings-row">
      <span>{label}</span>
      <div className="settings-input-group">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} disabled={disabled} />
        {changed && <button onClick={() => onSave(draft)} disabled={disabled} className="settings-save-btn">Save</button>}
      </div>
    </label>
  );
}
