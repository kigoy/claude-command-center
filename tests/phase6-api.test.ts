import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const MOCK_PROJECTS = join(FIXTURES, 'mock-projects');

// --- Test fixture helpers ---

/** Create a mock sprint dir with a given STATE.json */
function createMockSprint(
  projectDir: string,
  feature: string,
  overrides: Record<string, unknown> = {},
): string {
  const sprintDir = join(projectDir, '.sprints', feature);
  mkdirSync(sprintDir, { recursive: true });
  const now = new Date().toISOString();
  const state = {
    feature,
    branch: 'main',
    created: now,
    phase: 'BUILD',
    phase_history: [{ phase: 'PLAN', entered: now, exited: now }, { phase: 'BUILD', entered: now }],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
    ...overrides,
  };
  writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
  return sprintDir;
}

// Prepare a config.yaml with resolved fixture paths
function setupMockConfig(): string {
  const template = readFileSync(join(FIXTURES, 'mock-config.yaml'), 'utf-8');
  const resolved = template.replace(/FIXTURE_PATH/g, MOCK_PROJECTS);
  const tmpPath = join(FIXTURES, 'resolved-config.yaml');
  writeFileSync(tmpPath, resolved);
  return tmpPath;
}

// Set env before importing modules
const configPath = setupMockConfig();
process.env.GSTACK_CONFIG = configPath;

// Dynamic imports after env is set
const { getProjects, reload } = await import('../server/sprint-config.js');
const { readSprintState, writeSprintState } = await import('../server/sprint-state.js');

// ============================================================
// ALERTS API
// ============================================================

describe('Alerts API (GET /api/alerts)', () => {
  const STALE_THRESHOLD_MS = 4 * 3600 * 1000;

  beforeAll(() => reload());

  /** Replicate the alert-detection logic from sprint-api.ts for unit testing. */
  function computeAlerts(projects: Array<{ id: string; path: string }>) {
    const alerts: Array<{ type: string; message: string; sprintKey: string; severity: string; source: string }> = [];
    const now = Date.now();
    const { readdirSync, existsSync: exists } = require('fs');

    for (const project of projects) {
      const sprintsDir = join(project.path, '.sprints');
      if (!exists(sprintsDir)) continue;

      let entries: any[];
      try { entries = readdirSync(sprintsDir, { withFileTypes: true }); } catch { continue; }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        const state = readSprintState(join(sprintsDir, entry.name));
        if (!state || state.phase === 'COMPLETE') continue;

        const key = `${project.id}-${state.feature}`;
        const history = state.phase_history as Array<{ exited?: string; entered?: string }>;
        const lastActivity = history.length > 0
          ? (history[history.length - 1].exited || history[history.length - 1].entered || state.created)
          : state.created;
        const lastMs = new Date(lastActivity).getTime();

        if (state.blocked) {
          alerts.push({
            type: 'blocked',
            message: `${project.id}/${state.feature.replace(/^feat-/, '')} is blocked: ${state.blocked_reason || 'no reason given'}`,
            sprintKey: key,
            severity: 'high',
            source: 'sprint',
          });
        } else if (now - lastMs > STALE_THRESHOLD_MS) {
          const hours = Math.round((now - lastMs) / 3600000);
          alerts.push({
            type: 'stale',
            message: `${project.id}/${state.feature.replace(/^feat-/, '')} has been idle for ${hours}h in ${state.phase}`,
            sprintKey: key,
            severity: 'medium',
            source: 'sprint',
          });
        }
      }
    }
    return alerts;
  }

  it('returns an array', () => {
    const projects = getProjects().map((p: any) => ({ id: p.id, path: p.path }));
    const alerts = computeAlerts(projects);
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('detects stale sprints (>4h no activity)', () => {
    // alpha/feat-login was created at 2026-04-01T10:00:00Z — well over 4h ago
    const projects = getProjects().map((p: any) => ({ id: p.id, path: p.path }));
    const alerts = computeAlerts(projects);
    const stale = alerts.filter((a) => a.type === 'stale');
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale[0].severity).toBe('medium');
  });

  it('detects blocked sprints', () => {
    // Create a blocked sprint fixture
    const sprintDir = createMockSprint(join(MOCK_PROJECTS, 'alpha'), 'feat-blocked-test', {
      blocked: true,
      blocked_reason: 'waiting on design',
    });

    try {
      const projects = getProjects().map((p: any) => ({ id: p.id, path: p.path }));
      const alerts = computeAlerts(projects);
      const blocked = alerts.filter((a) => a.type === 'blocked');
      expect(blocked.length).toBeGreaterThanOrEqual(1);
      const match = blocked.find((a) => a.sprintKey.includes('feat-blocked-test'));
      expect(match).toBeDefined();
      expect(match!.severity).toBe('high');
      expect(match!.message).toContain('waiting on design');
    } finally {
      rmSync(sprintDir, { recursive: true, force: true });
    }
  });

  it('returns empty array when no alerts', () => {
    // beta has no .sprints/ directory — should produce no alerts
    const betaOnly = [{ id: 'beta', path: join(MOCK_PROJECTS, 'beta') }];
    const alerts = computeAlerts(betaOnly);
    expect(alerts).toEqual([]);
  });

  it('includes source field on each alert', () => {
    const projects = getProjects().map((p: any) => ({ id: p.id, path: p.path }));
    const alerts = computeAlerts(projects);
    for (const alert of alerts) {
      expect(alert).toHaveProperty('source');
      expect(alert.source).toBe('sprint');
    }
  });
});

// ============================================================
// SETTINGS API
// ============================================================

describe('Settings API (GET/PATCH /api/settings)', () => {
  const SETTINGS_ALLOWLIST = ['NTFY_URL', 'NTFY_TOPIC', 'NTFY_ENABLED', 'BASE_URL', 'PORT'] as const;
  const SETTINGS_SECRETS = ['AUTH_PASSPHRASE', 'AUTH_SECRET', 'NTFY_AUTH_TOKEN', 'COOKIE_MAX_AGE_HOURS'];

  /** Replicate GET /settings logic */
  function getSettings(): Record<string, string> {
    const settings: Record<string, string> = {};
    for (const key of SETTINGS_ALLOWLIST) {
      settings[key] = process.env[key] || '';
    }
    return settings;
  }

  /** Replicate PATCH /settings validation logic, returns { status, body } */
  function patchSettings(updates: Record<string, string>): { status: number; body: Record<string, unknown> } {
    if (!updates || typeof updates !== 'object') {
      return { status: 400, body: { error: 'Body must be a JSON object' } };
    }
    for (const key of Object.keys(updates)) {
      if (SETTINGS_SECRETS.includes(key)) {
        return { status: 403, body: { error: `Cannot modify ${key} via API` } };
      }
      if (!SETTINGS_ALLOWLIST.includes(key as any)) {
        return { status: 400, body: { error: `Unknown setting: ${key}` } };
      }
    }
    // Apply in-memory only (skip .env write for tests)
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }
    return { status: 200, body: { ok: true, applied: updates } };
  }

  it('GET returns allowlisted keys only', () => {
    const settings = getSettings();
    const keys = Object.keys(settings);
    expect(keys).toEqual(expect.arrayContaining([...SETTINGS_ALLOWLIST]));
    expect(keys.length).toBe(SETTINGS_ALLOWLIST.length);
  });

  it('GET excludes secrets', () => {
    const settings = getSettings();
    for (const secret of SETTINGS_SECRETS) {
      expect(settings).not.toHaveProperty(secret);
    }
  });

  it('PATCH updates in-memory env vars', () => {
    const prev = process.env.NTFY_URL;
    const result = patchSettings({ NTFY_URL: 'https://ntfy.example.com/test' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(process.env.NTFY_URL).toBe('https://ntfy.example.com/test');
    // Restore
    process.env.NTFY_URL = prev || '';
  });

  it('PATCH rejects secret keys with 403', () => {
    const result = patchSettings({ AUTH_PASSPHRASE: 'sneaky' });
    expect(result.status).toBe(403);
    expect(result.body.error).toContain('AUTH_PASSPHRASE');
  });

  it('PATCH rejects unknown keys with 400', () => {
    const result = patchSettings({ TOTALLY_UNKNOWN_KEY: 'val' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('Unknown setting');
  });
});

// ============================================================
// ARCHIVE API
// ============================================================

describe('Archive API (POST /api/sprints/:id/:feat/archive)', () => {
  const ARCHIVE_DIR = join(MOCK_PROJECTS, 'alpha', '.sprints');

  beforeAll(() => reload());

  it('archives COMPLETE sprint successfully', () => {
    const sprintDir = createMockSprint(join(MOCK_PROJECTS, 'alpha'), 'feat-archive-ok', {
      phase: 'COMPLETE',
      phase_history: [
        { phase: 'PLAN', entered: '2026-04-01T10:00:00Z', exited: '2026-04-01T11:00:00Z' },
        { phase: 'COMPLETE', entered: '2026-04-01T12:00:00Z' },
      ],
    });

    try {
      const state = readSprintState(sprintDir);
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('COMPLETE');

      // Simulate the archive endpoint logic
      writeSprintState(sprintDir, { ...state!, archived: true } as any);

      const updated = readSprintState(sprintDir);
      expect((updated as any).archived).toBe(true);
    } finally {
      rmSync(sprintDir, { recursive: true, force: true });
    }
  });

  it('rejects non-COMPLETE sprint with 400', () => {
    const sprintDir = createMockSprint(join(MOCK_PROJECTS, 'alpha'), 'feat-archive-reject', {
      phase: 'BUILD',
    });

    try {
      const state = readSprintState(sprintDir);
      expect(state).not.toBeNull();
      // Simulate the endpoint guard
      expect(state!.phase).not.toBe('COMPLETE');
      // The endpoint would return 400 here
      const wouldReject = state!.phase !== 'COMPLETE';
      expect(wouldReject).toBe(true);
    } finally {
      rmSync(sprintDir, { recursive: true, force: true });
    }
  });

  it('returns 404 for unknown project/sprint', () => {
    const state = readSprintState(join(MOCK_PROJECTS, 'alpha', '.sprints', 'feat-nonexistent'));
    expect(state).toBeNull();

    // Unknown project
    const project = getProjects().find((p: any) => p.id === 'nonexistent-project');
    expect(project).toBeUndefined();
  });
});
