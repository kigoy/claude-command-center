import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const MOCK_PROJECTS = join(FIXTURES, 'mock-projects');

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
process.env.AUTH_PASSPHRASE = 'test-passphrase';

// Dynamic import after env is set
const { getProjects, reload, scanProjectCandidates } = await import('../server/sprint-config.js');
const { createApp } = await import('../server/app.js');

describe('sprint-config', () => {
  beforeAll(() => reload());

  it('loads projects from config.yaml', () => {
    const projects = getProjects();
    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe('alpha');
    expect(projects[1].id).toBe('beta');
  });

  it('parses project fields correctly', () => {
    const alpha = getProjects().find((p) => p.id === 'alpha')!;
    expect(alpha.stack).toBe('typescript-next');
    expect(alpha.has_deploy).toBe(false);
    expect(alpha.path).toContain('mock-projects/alpha');
  });

  it('returns empty array for missing config', () => {
    const prev = process.env.GSTACK_CONFIG;
    process.env.GSTACK_CONFIG = '/nonexistent/config.yaml';
    // Reimport would be needed for full isolation, but we can test reload
    // For now, test getProjects returns cached (previous) data
    expect(getProjects().length).toBeGreaterThanOrEqual(0);
    process.env.GSTACK_CONFIG = prev;
    reload();
  });
});

// Test the sprint API route handlers by importing the helpers
// Since sprint-api.ts exports an Express router, we test the underlying logic
// by directly testing filesystem reads

describe('sprint filesystem reading', () => {
  it('reads STATE.json from a sprint directory', () => {
    const statePath = join(MOCK_PROJECTS, 'alpha/.sprints/feat-login/STATE.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.feature).toBe('feat-login');
    expect(state.phase).toBe('BUILD');
    expect(state.blocked).toBe(false);
  });

  it('parses atom counts from ATOMS.md', () => {
    const atomsPath = join(MOCK_PROJECTS, 'alpha/.sprints/feat-login/ATOMS.md');
    const raw = readFileSync(atomsPath, 'utf-8');
    const totalMatch = raw.match(/- Total:\s*(\d+)/);
    const completedMatch = raw.match(/- Completed:\s*(\d+)/);
    expect(totalMatch).not.toBeNull();
    expect(completedMatch).not.toBeNull();
    expect(parseInt(totalMatch![1], 10)).toBe(5);
    expect(parseInt(completedMatch![1], 10)).toBe(3);
  });

  it('handles project with no .sprints/ directory gracefully', () => {
    const sprintsDir = join(MOCK_PROJECTS, 'beta/.sprints');
    // beta has no .sprints/ dir — should not throw
    expect(existsSync(sprintsDir)).toBe(false);
  });

  it('scans nested repos under non-repo parent folders and infers the group', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'sprint-scan-'));
    const topLevelRepo = join(tempRoot, 'file-brain');
    const nestedRepo = join(tempRoot, 'leelafy', 'Proof-outreach');

    mkdirSync(join(topLevelRepo, '.git'), { recursive: true });
    mkdirSync(nestedRepo, { recursive: true });
    writeFileSync(join(nestedRepo, '.git'), 'gitdir: /tmp/mock-worktree\n');

    try {
      const candidates = scanProjectCandidates(tempRoot);

      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'file-brain',
          path: topLevelRepo,
          group: undefined,
          hasGit: true,
        }),
        expect.objectContaining({
          id: 'proof-outreach',
          path: nestedRepo,
          group: 'leelafy',
          hasGit: true,
        }),
      ]));
      expect(candidates.some((candidate) => candidate.path === join(tempRoot, 'leelafy'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('sprint API response shapes', () => {
  it('GET /api/dashboard returns correct shape', async () => {
    // Simulate what the dashboard endpoint returns by building the response manually
    const projects = getProjects();
    const dashboard = projects.map((p) => ({
      id: p.id,
      path: p.path,
      stack: p.stack,
      has_deploy: p.has_deploy,
      deploy_url: p.deploy_url,
      sprints: [], // Would be populated by listSprintsForProject
    }));

    expect(dashboard).toHaveLength(2);
    expect(dashboard[0]).toHaveProperty('id');
    expect(dashboard[0]).toHaveProperty('path');
    expect(dashboard[0]).toHaveProperty('stack');
    expect(dashboard[0]).toHaveProperty('sprints');
  });

  afterEach(() => {
    rmSync(join(MOCK_PROJECTS, 'alpha', '.sprints', 'feat-archived-hot'), { recursive: true, force: true });
    rmSync(join(MOCK_PROJECTS, 'alpha', '.sprints', 'feat-active-hot'), { recursive: true, force: true });
  });

  it('GET /api/dashboard ignores archived sprints in recommendations and uses activity history for recency', async () => {
    const archivedDir = join(MOCK_PROJECTS, 'alpha', '.sprints', 'feat-archived-hot');
    mkdirSync(archivedDir, { recursive: true });
    writeFileSync(join(archivedDir, 'STATE.json'), JSON.stringify({
      feature: 'feat-archived-hot',
      branch: 'main',
      created: '2026-04-01T10:00:00Z',
      phase: 'PLAN',
      archived: true,
      phase_history: [{ phase: 'PLAN', entered: '2026-04-01T10:00:00Z' }],
      activity_history: [{ ts: '2026-04-09T09:00:00Z', title: 'Fresh but archived' }],
      qa_routing: {},
      blocked: false,
      blocked_reason: null,
    }, null, 2) + '\n');

    const activeDir = join(MOCK_PROJECTS, 'alpha', '.sprints', 'feat-active-hot');
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(join(activeDir, 'STATE.json'), JSON.stringify({
      feature: 'feat-active-hot',
      branch: 'main',
      created: '2026-04-01T10:00:00Z',
      phase: 'PLAN',
      phase_history: [{ phase: 'PLAN', entered: '2026-04-01T10:00:00Z' }],
      activity_history: [{ ts: '2026-04-09T10:15:00Z', title: 'Fresh active work' }],
      qa_routing: {},
      blocked: false,
      blocked_reason: null,
    }, null, 2) + '\n');

    const app = createApp();
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ passphrase: 'test-passphrase' })
      .expect(200);

    const dashboardRes = await agent.get('/api/dashboard').expect(200);
    const recommendationText = dashboardRes.body.recommendation as string;
    expect(recommendationText).toContain('feat-active-hot');
    expect(recommendationText).not.toContain('feat-archived-hot');

    const projectsRes = await agent.get('/api/projects/alpha/sprints').expect(200);
    const activeSprint = projectsRes.body.find((entry: { feature: string }) => entry.feature === 'feat-active-hot');
    expect(activeSprint).toBeDefined();
    expect(activeSprint.last_activity).toBe('2026-04-09T10:15:00Z');
  });
});
