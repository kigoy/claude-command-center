import { Router } from 'express';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getProjects,
  getGroups,
  addProject,
  updateProjectPath,
  updateProjectConfig,
  createGroup,
  updateGroup,
  scanProjectCandidates,
} from './sprint-config.js';
import { readSprintState, writeSprintState, deriveChainStatus, type SprintState, type ChainStatus } from './sprint-state.js';
import { resolveAtomCounts } from './sprint-atoms.js';
import { rankRecommendations, type SprintContext } from './sprint-recommendations.js';
import { buildRetroSummary, markRetroRun } from './sprint-retro.js';
import { buildAnalytics } from './sprint-analytics.js';
import { suggestSkills } from './sprint-suggestions.js';
import { getSprintSessions, type TmuxSprintSession } from './tmux-detect.js';
import { buildExploreIdeaPrompt, buildSprintBootstrapPrompt } from './sprint-command-help.js';
import { deleteSprintArtifacts } from './sprint-cleanup.js';
import { buildSprintRemixPayload } from './sprint-remix.js';
import { reviewSprintState } from './sprint-review.js';
import { ensureProjectInstructionFiles } from './project-instructions.js';
import { appendSprintActivity, buildSprintHistory } from './sprint-history.js';
import { getAutoSprintAction } from './sprint-auto.js';
import { disableAutomation, enableRecommendedAutomation, isRecommendedAutomationEnabled } from './sprint-automation.js';
import { executeSprintCommand, getSprintToolId, launchSprintTool } from './sprint-session.js';
import { listRequests, setResponse } from './mcp-responses.js';
import {
  getLastSprintActivity,
  isStaleSprintState,
} from '../shared/sprint-health.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

function maxIsoTimestamp(...timestamps: Array<string | null | undefined>): string {
  let latest = '';
  let latestMs = -1;

  for (const ts of timestamps) {
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (!Number.isNaN(ms) && ms > latestMs) {
      latest = ts;
      latestMs = ms;
    }
  }

  return latest || new Date(0).toISOString();
}

// --- Types ---

interface SprintSummary {
  feature: string;
  phase: string;
  archived?: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  last_activity: string;
  branch: string;
  tmux_session: string;
  tmux_active: boolean;
  chain_status: ChainStatus;
  suggestions: string[];
  created: string;
  tool_id: string;
  automation_enabled: boolean;
  phase_history: Array<{ phase?: string; entered?: string; exited?: string }>;
}

interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  path_exists: boolean;
  sprints: SprintSummary[];
}

// --- Helpers ---

/** Sanitize path segment to prevent directory traversal and null byte injection */
function sanitizeSegment(segment: string): string {
  if (segment.includes('\x00')) return '';
  return segment.replace(/[\/\\\.]+/g, '').replace(/^\.+/, '');
}

/* Atom parsing extracted to sprint-atoms.ts (shared with sprint-sse.ts) */

/** Find a matching tmux session for a sprint from the cached background poller. */
function findTmuxSession(projectId: string, feature: string): TmuxSprintSession | null {
  const featureBase = feature.replace(/^feat-/, '');
  for (const s of getSprintSessions()) {
    if (s.projectId === projectId && s.feature === featureBase) {
      return s;
    }
  }
  return null;
}

/** List all sprints for a project by reading its .sprints/ directory. */
function listSprintsForProject(
  projectId: string,
  projectPath: string,
): SprintSummary[] {
  const sprintsDir = join(projectPath, '.sprints');
  if (!existsSync(sprintsDir)) return [];

  const sprints: SprintSummary[] = [];
  try {
    const entries = readdirSync(sprintsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const featureDir = join(sprintsDir, entry.name);
      let state = readSprintState(featureDir);
      if (!state) {
        // Auto-create STATE.json for orphan sprint dirs
        const now = new Date().toISOString();
        state = {
          feature: entry.name,
          branch: 'main',
          created: now,
          phase: 'PLAN',
          tool_id: 'claude',
          automation: { mode: 'manual', retro_sent_at: null },
          phase_history: [],
          activity_history: [],
          qa_routing: {},
          blocked: false,
          blocked_reason: null,
        };
        try {
          writeFileSync(join(featureDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
        } catch {
          continue; // Can't write — skip this dir
        }
      }

      const atoms = resolveAtomCounts(featureDir, state);
      const tmuxMatch = findTmuxSession(projectId, state.feature);
      const lastActivity = maxIsoTimestamp(getLastSprintActivity(state), tmuxMatch?.activityAt, state.created);
      const hasUi = state.qa_routing?.has_ui === true;
      sprints.push({
        feature: state.feature,
        phase: state.phase,
        archived: (state as any).archived === true,
        blocked: state.blocked,
        blocked_reason: state.blocked_reason,
        atoms_total: atoms.total,
        atoms_completed: atoms.completed,
        has_atoms: atoms.has_atoms,
        last_activity: lastActivity,
        branch: state.branch,
        tmux_session: tmuxMatch?.sessionName ?? `${projectId}-${state.feature.replace(/^feat-/, '')}`,
        tmux_active: tmuxMatch !== null,
        chain_status: deriveChainStatus(state),
        suggestions: suggestSkills({
          feature: state.feature,
          phase: state.phase,
          blocked: state.blocked,
          last_activity: lastActivity,
          has_ui: hasUi,
        }),
        created: state.created,
        tool_id: getSprintToolId(state),
        automation_enabled: isRecommendedAutomationEnabled(state),
        phase_history: (state.phase_history as Array<{ phase?: string; entered?: string; exited?: string }>).map(
          (e) => ({ phase: e.phase, entered: e.entered, exited: e.exited }),
        ),
      });
    }
  } catch {
    // Can't read directory — return empty
  }
  return sprints;
}

// --- Shared ---

function buildProjectSummaries(): ProjectSummary[] {
  return getProjects().map((p) => ({
    id: p.id,
    path: p.path,
    stack: p.stack,
    has_deploy: p.has_deploy,
    deploy_url: p.deploy_url,
    path_exists: existsSync(p.path),
    sprints: existsSync(p.path) ? listSprintsForProject(p.id, p.path) : [],
  }));
}

// --- Routes ---

/** GET /api/projects — all projects with sprint summaries */
router.get('/projects', (_req, res) => {
  res.json(buildProjectSummaries());
});

/** GET /api/config — editable project/group config with group membership expansion */
router.get('/config', (_req, res) => {
  const groups = getGroups();
  const projects = getProjects().map((project) => ({
    ...project,
    groupIds: groups.filter((group) => group.projects.includes(project.id)).map((group) => group.id),
  }));
  res.json({ projects, groups });
});

/** PATCH /api/projects/:id/path — update project directory path */
router.patch('/projects/:id/path', (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== 'string') {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  const resolved = join(path);
  if (!resolved.startsWith(ALLOWED_BASE + '/') && resolved !== ALLOWED_BASE) {
    res.status(400).json({ error: 'Path must be inside /Volumes/Extreme Pro/' });
    return;
  }

  if (!existsSync(resolved)) {
    res.status(400).json({ error: `Directory does not exist: ${resolved}` });
    return;
  }

  try {
    // Create .sprints/ if missing
    const sprintsDir = join(resolved, '.sprints');
    if (!existsSync(sprintsDir)) mkdirSync(sprintsDir, { recursive: true });
    ensureProjectInstructionFiles(resolved);

    updateProjectPath(req.params.id, resolved);
    res.json({ ok: true, path: resolved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/config/projects/:id — update editable project config */
router.patch('/config/projects/:id', (req, res) => {
  const { path, stack, has_deploy, deploy_url, default_qa_routing, groupIds } = req.body ?? {};
  if (path !== undefined) {
    if (typeof path !== 'string' || !path.trim()) {
      res.status(400).json({ error: 'path must be a non-empty string' });
      return;
    }
    const resolved = join(path);
    if ((!resolved.startsWith(ALLOWED_BASE + '/') && resolved !== ALLOWED_BASE) || !existsSync(resolved)) {
      res.status(400).json({ error: 'path must be an existing directory inside /Volumes/Extreme Pro/' });
      return;
    }
  }

  if (stack !== undefined && (!stack || !ALLOWED_STACKS.has(stack))) {
    res.status(400).json({ error: `Invalid stack. Allowed: ${[...ALLOWED_STACKS].join(', ')}` });
    return;
  }

  if (groupIds !== undefined && !Array.isArray(groupIds)) {
    res.status(400).json({ error: 'groupIds must be an array' });
    return;
  }

  try {
    updateProjectConfig(req.params.id, {
      path: typeof path === 'string' ? join(path) : undefined,
      stack,
      has_deploy: typeof has_deploy === 'boolean' ? has_deploy : undefined,
      deploy_url: typeof deploy_url === 'string' ? deploy_url.trim() : undefined,
      default_qa_routing: typeof default_qa_routing === 'string' ? default_qa_routing : undefined,
      groupIds: Array.isArray(groupIds) ? groupIds.filter((value) => typeof value === 'string') : undefined,
    });
    res.json({ ok: true });
  } catch (err: any) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

/** POST /api/config/groups — create a new group */
router.post('/config/groups', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (!id || !label) {
    res.status(400).json({ error: 'id and label are required' });
    return;
  }
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
    res.status(400).json({ error: 'Group id must be alphanumeric with dashes or underscores' });
    return;
  }

  try {
    createGroup(id, label);
    res.status(201).json({ ok: true });
  } catch (err: any) {
    const status = /already exists/i.test(err.message) ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

/** PATCH /api/config/groups/:id — update group label and memberships */
router.patch('/config/groups/:id', (req, res) => {
  const { label, projects } = req.body ?? {};
  if (label !== undefined && typeof label !== 'string') {
    res.status(400).json({ error: 'label must be a string' });
    return;
  }
  if (projects !== undefined && !Array.isArray(projects)) {
    res.status(400).json({ error: 'projects must be an array' });
    return;
  }

  try {
    updateGroup(req.params.id, {
      label: typeof label === 'string' ? label.trim() : undefined,
      projects: Array.isArray(projects) ? projects.filter((value) => typeof value === 'string') : undefined,
    });
    res.json({ ok: true });
  } catch (err: any) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

/** GET /api/config/scan — scan base path for project candidates */
router.get('/config/scan', (req, res) => {
  const basePath = typeof req.query.basePath === 'string' && req.query.basePath.trim()
    ? req.query.basePath.trim()
    : ALLOWED_BASE;

  if (!basePath.startsWith(ALLOWED_BASE)) {
    res.status(400).json({ error: 'basePath must be inside /Volumes/Extreme Pro' });
    return;
  }

  res.json({ basePath, candidates: scanProjectCandidates(basePath) });
});

/** GET /api/projects/:id/sprints — sprints for a single project */
router.get('/projects/:id/sprints', (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.id}' not found` });
    return;
  }
  res.json(listSprintsForProject(project.id, project.path));
});

/** GET /api/sprints/:projectId/:featureId/state — raw STATE.json */
router.get('/sprints/:projectId/:featureId/state', (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${req.params.featureId}' not found` });
    return;
  }
  res.json(state);
});

/** GET /api/sprints/:projectId/:featureId/history — combined activity/status history */
router.get('/sprints/:projectId/:featureId/history', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${req.params.featureId}' not found` });
    return;
  }

  res.json(buildSprintHistory(state));
});

/** GET /api/sprints/:projectId/:featureId/atoms — raw ATOMS.md content */
router.get('/sprints/:projectId/:featureId/atoms', (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const atomsPath = join(project.path, '.sprints', featureId, 'ATOMS.md');
  try {
    const content = readFileSync(atomsPath, 'utf-8');
    res.type('text/markdown').send(content);
  } catch {
    res.status(404).json({ error: `ATOMS.md not found for '${req.params.featureId}'` });
  }
});

/** GET /api/sprints/:projectId/:featureId/review — sprint validity/state review */
router.get('/sprints/:projectId/:featureId/review', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${req.params.featureId}' not found` });
    return;
  }

  const atoms = resolveAtomCounts(sprintDir, state);
  const tmuxMatch = findTmuxSession(project.id, state.feature);

  res.json(reviewSprintState({
    state,
    tmuxActive: tmuxMatch !== null,
    hasAtoms: atoms.has_atoms,
    atomsTotal: atoms.total,
  }));
});

/** POST /api/sprints — create a new sprint directory + STATE.json, open tmux session */
router.post('/sprints', (req, res) => {
  const { projectId, featureName, toolId } = req.body;
  if (!projectId || !featureName) {
    res.status(400).json({ error: 'projectId and featureName are required' });
    return;
  }

  const project = getProjects().find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${projectId}' not found` });
    return;
  }

  const safeName = sanitizeSegment(featureName);
  if (!safeName) {
    res.status(400).json({ error: 'Invalid feature name' });
    return;
  }

  const dirName = `feat-${safeName}`;
  const sprintDir = join(project.path, '.sprints', dirName);

  if (existsSync(sprintDir)) {
    res.status(409).json({ error: `Sprint '${dirName}' already exists` });
    return;
  }

  const now = new Date().toISOString();
  const state: SprintState = {
    feature: dirName,
    branch: 'main',
    created: now,
    phase: 'PLAN',
    tool_id: toolId || 'claude',
    automation: { mode: 'manual', retro_sent_at: null },
    origin: {
      type: 'new-sprint',
      project_id: projectId,
      feature_name: safeName,
    },
    phase_history: [{ phase: 'PLAN', entered: now }],
    activity_history: [{
      ts: now,
      kind: 'system',
      title: 'Sprint created',
      detail: 'Started from New Sprint.',
      phase: 'PLAN',
    }],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
  };

  try {
    ensureProjectInstructionFiles(project.path);
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
  } catch (err: any) {
    res.status(500).json({ error: `Failed to create sprint directory: ${err.message}` });
    return;
  }

  // Open a new tmux session in the project directory
  const sessionName = `${projectId}-${safeName}`;
  try {
    launchSprintTool({
      sessionName,
      cwd: project.path,
      toolId: state.tool_id,
      projectId,
      featureId: state.feature,
      prompt: buildSprintBootstrapPrompt({
        projectId,
        projectPath: project.path,
        sprintDir,
        state,
      }),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(201).json({ feature: dirName, project: projectId, session: sessionName });
});

/** GET /api/dashboard — combined view: all projects, all sprints, ranked recommendations */
router.get('/dashboard', (_req, res) => {
  const projects = buildProjectSummaries();

  // Flatten all sprints into SprintContext for the recommendation engine
  const allSprints: SprintContext[] = projects.flatMap((project) =>
    project.sprints.map((s) => ({
      projectId: project.id,
      feature: s.feature,
      phase: s.phase,
      archived: s.archived,
      blocked: s.blocked,
      blocked_reason: s.blocked_reason,
      atoms_total: s.atoms_total,
      atoms_completed: s.atoms_completed,
      last_activity: s.last_activity,
    })),
  );

  const recommendations = rankRecommendations(
    allSprints.filter((s) => !s.archived),
    3,
  );

  // Backward-compat: single recommendation string = top item's text
  const recommendation = recommendations.length > 0
    ? recommendations.map((r) => r.text).join(' -> ')
    : '';

  res.json({ groups: getGroups(), projects, recommendations, recommendation });
});

/** GET /api/sprints/:projectId/:featureId/detail — full STATE.json with atom counts */
router.get('/sprints/:projectId/:featureId/detail', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${req.params.featureId}' not found` });
    return;
  }

  const atoms = resolveAtomCounts(sprintDir, state);
  const tmuxMatch = findTmuxSession(project.id, state.feature);

  res.json({
    ...state,
    archived: (state as any).archived === true,
    atoms_total: atoms.total,
    atoms_completed: atoms.completed,
    has_atoms: atoms.has_atoms,
    tmux_session: tmuxMatch?.sessionName ?? `${project.id}-${state.feature.replace(/^feat-/, '')}`,
    tmux_active: tmuxMatch !== null,
    tool_id: getSprintToolId(state),
    automation_enabled: isRecommendedAutomationEnabled(state),
    chain_status: deriveChainStatus(state),
    activity_history: Array.isArray(state.activity_history) ? state.activity_history : [],
  });
});

// --- Allowed sprint commands (whitelist) ---
const ALLOWED_COMMANDS = new Set([
  '/review', '/qa', '/qa-only', '/ship', '/document-release',
  '/retro', '/investigate', '/office-hours', '/plan-ceo-review',
  '/plan-eng-review', '/plan-design-review', '/browse', '/careful',
  '/freeze', '/guard', '/unfreeze', '/benchmark', '/canary',
  '/autoplan',
]);

/** Validate a command is safe to send to tmux — whitelist only. */
function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();
  if (ALLOWED_COMMANDS.has(trimmed)) return true;
  if (/^\/sprint\s+(new|switch|status|close|retro)\b/.test(trimmed)) return true;
  return false;
}

function transitionSprintState(input: {
  sprintDir: string;
  state: SprintState;
  toPhase: string;
  summary?: string;
}) {
  const { sprintDir, state, toPhase, summary } = input;
  const now = new Date().toISOString();
  const updatedHistory = (state.phase_history as Array<Record<string, unknown>>).map((entry) => {
    if (entry.phase === state.phase && !entry.exited) {
      const closed: Record<string, unknown> = { ...entry, exited: now };
      if (summary) closed.summary = summary.slice(0, 1000);
      return closed;
    }
    return entry;
  });
  updatedHistory.push({ phase: toPhase, entered: now });

  const updatedState: SprintState = { ...state, phase: toPhase, phase_history: updatedHistory };
  const finalState = appendSprintActivity(updatedState, {
    ts: now,
    kind: 'status',
    title: `Transitioned ${state.phase} -> ${toPhase}`,
    detail: summary ? summary.slice(0, 1000) : undefined,
    phase: toPhase,
  });
  writeSprintState(sprintDir, finalState);
  return finalState;
}

function getPendingRecommendedRequest(projectId: string, featureId: string) {
  return listRequests().find(
    (request) =>
      request.projectId === projectId
      && request.featureId === featureId
      && Array.isArray(request.options)
      && request.options.length > 0,
  ) ?? null;
}

/** POST /api/sprints/:projectId/:featureId/exec — send command to sprint tmux session */
router.post('/sprints/:projectId/:featureId/exec', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${featureId}' not found` });
    return;
  }

  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    res.status(400).json({ error: 'command is required' });
    return;
  }

  if (!isCommandSafe(command)) {
    res.status(400).json({ error: 'Command contains disallowed characters' });
    return;
  }

  try {
    const result = executeSprintCommand({
      projectId: req.params.projectId,
      projectPath: project.path,
      featureId,
      sprintDir,
      state,
      command,
    });
    res.json({ session: result.sessionName, command: command.trim(), sent: true, prompt: result.prompt });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to send command: ${err.message}` });
  }
});

// --- Valid phase transitions ---
const VALID_TRANSITIONS: Record<string, string[]> = {
  PLAN: ['BUILD'],
  BUILD: ['REVIEW'],
  REVIEW: ['QA', 'SHIP'],  // QA only if qa_required, SHIP if not
  QA: ['SHIP'],
  SHIP: ['COMPLETE'],
};

/** POST /api/sprints/:projectId/:featureId/transition — advance sprint phase */
router.post('/sprints/:projectId/:featureId/transition', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${featureId}' not found` });
    return;
  }

  const { to_phase, summary } = req.body;
  if (!to_phase || typeof to_phase !== 'string') {
    res.status(400).json({ error: 'to_phase is required' });
    return;
  }

  // Validate the transition
  const allowed = VALID_TRANSITIONS[state.phase];
  if (!allowed || !allowed.includes(to_phase)) {
    res.status(400).json({
      error: `Cannot transition from ${state.phase} to ${to_phase}. Allowed: ${allowed?.join(', ') || 'none'}`,
    });
    return;
  }

  // Chain enforcement: REVIEW → SHIP requires !qa_required
  if (state.phase === 'REVIEW' && to_phase === 'SHIP') {
    const chain = deriveChainStatus(state);
    if (chain.qa_required) {
      res.status(400).json({ error: 'Cannot skip QA — has_ui is true. Transition to QA first.' });
      return;
    }
  }

  try {
    const finalState = transitionSprintState({
      sprintDir,
      state,
      toPhase: to_phase,
      summary: summary && typeof summary === 'string' ? summary : undefined,
    });
    res.json({ phase: to_phase, chain_status: deriveChainStatus(finalState) });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to write STATE.json: ${err.message}` });
    return;
  }
});

router.post('/sprints/:projectId/:featureId/auto', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${featureId}' not found` });
    return;
  }

  try {
    const autoState = enableRecommendedAutomation(state);
    let nextState = appendSprintActivity(autoState, {
      ts: new Date().toISOString(),
      kind: 'status',
      title: 'Auto It enabled',
      detail: 'Will keep taking recommended workflow answers automatically.',
      phase: autoState.phase,
    });

    const pendingRequest = getPendingRecommendedRequest(req.params.projectId, featureId);
    if (pendingRequest?.options[0]) {
      setResponse(pendingRequest.requestId, pendingRequest.options[0]);
      nextState = appendSprintActivity(nextState, {
        ts: new Date().toISOString(),
        kind: 'action',
        title: 'Accepted recommended answer',
        detail: `Responded with ${pendingRequest.options[0]}.`,
        phase: nextState.phase,
      });
      writeSprintState(sprintDir, nextState);
      res.json({
        phase: nextState.phase,
        chain_status: deriveChainStatus(nextState),
        automation_enabled: true,
        answered_request_id: pendingRequest.requestId,
        response: pendingRequest.options[0],
        sent: false,
      });
      return;
    }

    const autoAction = getAutoSprintAction({
      phase: state.phase,
      qaRequired: deriveChainStatus(state).qa_required,
    });

    if (!autoAction) {
      writeSprintState(sprintDir, nextState);
      res.status(400).json({ error: `No automatic next step is available for phase ${state.phase}` });
      return;
    }

    nextState = appendSprintActivity(nextState, {
      ts: new Date().toISOString(),
      kind: 'status',
      title: 'Auto It next step',
      detail: `Starting with ${autoAction.command}.`,
      phase: nextState.phase,
    });
    writeSprintState(sprintDir, nextState);

    const result = executeSprintCommand({
      projectId: req.params.projectId,
      projectPath: project.path,
      featureId,
      sprintDir,
      state: readSprintState(sprintDir) || nextState,
      command: autoAction.command,
    });
    res.json({
      command: autoAction.command,
      to_phase: autoAction.toPhase,
      phase: result.state.phase,
      chain_status: deriveChainStatus(result.state),
      automation_enabled: true,
      sent: true,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to auto-run sprint: ${err.message}` });
  }
});

router.post('/sprints/:projectId/:featureId/automation', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: `Sprint '${featureId}' not found` });
    return;
  }

  const enabled = req.body?.enabled !== false;
  const nextState = enabled ? enableRecommendedAutomation(state) : disableAutomation(state);

  try {
    writeSprintState(sprintDir, appendSprintActivity(nextState, {
      ts: new Date().toISOString(),
      kind: 'status',
      title: enabled ? 'Auto It enabled' : 'Auto It disabled',
      detail: enabled
        ? 'Future recommended workflow answers will be accepted automatically.'
        : 'Sprint returned to manual workflow control.',
      phase: nextState.phase,
    }));
    res.json({ automation_enabled: enabled });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to update automation: ${err.message}` });
  }
});

/** GET /api/retro — cross-project retrospective aggregation */
router.get('/retro', (_req, res) => {
  res.json(buildRetroSummary());
});

/** POST /api/retro/mark — mark retro as completed */
router.post('/retro/mark', (_req, res) => {
  markRetroRun();
  res.json({ marked: true });
});

/** GET /api/analytics — sprint analytics: time-in-phase, compliance, atoms-per-sprint */
router.get('/analytics', (_req, res) => {
  res.json(buildAnalytics());
});

/** GET /api/briefing — morning briefing: sprint status + sync report + retro summary */
router.get('/briefing', (_req, res) => {
  const GSTACK_ROOT = process.env.GSTACK_ROOT || '/Volumes/Extreme Pro/.gstack';
  const diffReportPath = join(GSTACK_ROOT, 'sync', 'diff-report.md');

  // Sprint status from dashboard
  const projects = buildProjectSummaries();
  const sprintStatus = projects.map((p) => ({
    id: p.id,
    active_sprints: p.sprints.filter((s) => s.phase !== 'COMPLETE').length,
    top_sprint: p.sprints.find((s) => s.phase !== 'COMPLETE')?.feature ?? null,
  }));

  // Sync report if updated in last 24h
  let syncReport: string | null = null;
  try {
    const stat = statSync(diffReportPath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 24) {
      syncReport = readFileSync(diffReportPath, 'utf-8');
    }
  } catch {
    // No diff report
  }

  // Retro summary if due
  const retro = buildRetroSummary();
  const retroSummary = retro.retro_due ? {
    retro_due: true,
    days_since_last: retro.days_since_last_retro,
    sprints_completed: retro.aggregate.sprints_completed,
    atoms_shipped: retro.aggregate.atoms_shipped,
    chain_compliance_pct: retro.aggregate.chain_compliance_pct,
  } : null;

  res.json({
    generated_at: new Date().toISOString(),
    sprint_status: sprintStatus,
    sync_report: syncReport,
    retro_summary: retroSummary,
  });
});

/** GET /api/skills/new — check for newly detected upstream skills */
router.get('/skills/new', (_req, res) => {
  const GSTACK_ROOT = process.env.GSTACK_ROOT || '/Volumes/Extreme Pro/.gstack';
  const newSkillsPath = join(GSTACK_ROOT, 'sync', 'new-skills.json');
  try {
    const raw = readFileSync(newSkillsPath, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.json([]);
  }
});

/** POST /api/skills/new/dismiss — clear new-skills notification */
router.post('/skills/new/dismiss', (_req, res) => {
  const GSTACK_ROOT = process.env.GSTACK_ROOT || '/Volumes/Extreme Pro/.gstack';
  const newSkillsPath = join(GSTACK_ROOT, 'sync', 'new-skills.json');
  try {
    unlinkSync(newSkillsPath);
  } catch {
    // File may not exist — that's fine
  }
  res.json({ dismissed: true });
});

const ALLOWED_BASE = '/Volumes/Extreme Pro';
const ALLOWED_STACKS = new Set([
  'python-fastapi-sveltekit', 'typescript-next', 'python-django', 'node-express-react', 'other',
]);

/** POST /api/projects — add an existing project directory to config.yaml */
router.post('/projects', (req, res) => {
  const { path, name, stack, group, has_deploy, deploy_url } = req.body;
  if (!path || !name || !stack) {
    res.status(400).json({ error: 'path, name, and stack are required' });
    return;
  }

  // Path traversal guard
  const resolved = join(path);
  if (!resolved.startsWith(ALLOWED_BASE + '/') && resolved !== ALLOWED_BASE) {
    res.status(400).json({ error: 'Path must be inside /Volumes/Extreme Pro/' });
    return;
  }

  if (!ALLOWED_STACKS.has(stack)) {
    res.status(400).json({ error: `Invalid stack. Allowed: ${[...ALLOWED_STACKS].join(', ')}` });
    return;
  }

  if (!existsSync(resolved)) {
    res.status(400).json({ error: `Directory does not exist: ${resolved}` });
    return;
  }

  const projectId = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (getProjects().some((p) => p.id === projectId)) {
    res.status(409).json({ error: `Project '${projectId}' already exists` });
    return;
  }

  try {
    // Create .sprints/ if missing
    const sprintsDir = join(resolved, '.sprints');
    if (!existsSync(sprintsDir)) mkdirSync(sprintsDir, { recursive: true });

    addProject(projectId, {
      path: resolved,
      stack,
      has_deploy: !!has_deploy,
      deploy_url: has_deploy ? deploy_url : undefined,
    }, group || undefined);
    ensureProjectInstructionFiles(resolved);

    res.status(201).json({ projectId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/explore-idea — explore in existing project or create new project */
router.post('/explore-idea', (req, res) => {
  const { name, description, group, projectId, toolId } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) {
    res.status(400).json({ error: 'Invalid name' });
    return;
  }

  // --- Mode: existing project (creates a sprint inside it) ---
  if (projectId) {
    const project = getProjects().find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ error: `Project '${projectId}' not found` });
      return;
    }

    const dirName = `feat-${slug}`;
    const sprintDir = join(project.path, '.sprints', dirName);
    if (existsSync(sprintDir)) {
      res.status(409).json({ error: `Sprint '${dirName}' already exists in ${projectId}` });
      return;
    }

    try {
      ensureProjectInstructionFiles(project.path);
      mkdirSync(sprintDir, { recursive: true });
      const now = new Date().toISOString();
      const state: SprintState = {
        feature: dirName,
        branch: 'main',
        created: now,
        phase: 'PLAN',
        tool_id: toolId || 'claude',
        automation: { mode: 'manual', retro_sent_at: null },
        origin: {
          type: 'explore-idea',
          mode: 'existing',
          project_id: projectId,
          idea_name: slug,
          description: typeof description === 'string' ? description.slice(0, 1000) : '',
        },
        phase_history: [{ phase: 'PLAN', entered: now }],
        activity_history: [{
          ts: now,
          kind: 'system',
          title: 'Explore Idea sprint created',
          detail: 'Started from Explore Idea in an existing project.',
          phase: 'PLAN',
        }],
        qa_routing: {},
        blocked: false,
        blocked_reason: null,
      };
      writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');

      // Open tmux session
      const sessionName = `${projectId}-${slug}`;
      try {
        const prompt = buildExploreIdeaPrompt({
          projectId,
          projectPath: project.path,
          sprintDir,
          state,
          description: typeof description === 'string' ? description.slice(0, 1000) : undefined,
          toolId: state.tool_id,
        });
        launchSprintTool({
          sessionName,
          cwd: project.path,
          toolId: state.tool_id,
          prompt,
          projectId,
          featureId: state.feature,
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }

      res.status(201).json({ projectId, session: sessionName, path: project.path, feature: dirName });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // --- Mode: new project (creates directory + config entry) ---
  const projectPath = `/Volumes/Extreme Pro/${slug}`;
  if (existsSync(projectPath)) {
    res.status(409).json({ error: `Directory already exists: ${projectPath}` });
    return;
  }

  try {
    mkdirSync(projectPath, { recursive: true });

    // Write CLAUDE.md from template (includes orchestrator + skills references)
    const GSTACK_ROOT = process.env.GSTACK_ROOT || '/Volumes/Extreme Pro/.gstack';
    const tmplPath = join(GSTACK_ROOT, 'templates', 'CLAUDE.md.tmpl');
    let claudeMd: string;
    try {
      claudeMd = readFileSync(tmplPath, 'utf-8');
    } catch {
      // Fallback if template missing
      claudeMd = `# ${slug}\n\n## Workflow\n\nSprint Command is the development workflow engine.\n- Orchestrator: /Volumes/Extreme Pro/.gstack/orchestrator.md\n- Skills: /Volumes/Extreme Pro/.gstack/skills/\n\n## Post-Task\n\nCreate FOR_YOCHAI.md after significant work. Coffee-chat tone.\n`;
    }
    writeFileSync(join(projectPath, 'CLAUDE.md'), claudeMd);
    ensureProjectInstructionFiles(projectPath);

    const sprintDir = join(projectPath, '.sprints', 'feat-exploration');
    mkdirSync(sprintDir, { recursive: true });
    const now = new Date().toISOString();
    const state: SprintState = {
      feature: 'feat-exploration',
      branch: 'main',
      created: now,
      phase: 'PLAN',
      tool_id: toolId || 'claude',
      automation: { mode: 'manual', retro_sent_at: null },
      origin: {
        type: 'explore-idea',
        mode: 'new',
        project_id: slug,
        group_id: typeof group === 'string' ? group : '',
        idea_name: slug,
        description: typeof description === 'string' ? description.slice(0, 1000) : '',
      },
      phase_history: [{ phase: 'PLAN', entered: now }],
      activity_history: [{
        ts: now,
        kind: 'system',
        title: 'Explore Idea project created',
        detail: 'Created a new project from Explore Idea.',
        phase: 'PLAN',
      }],
      qa_routing: {},
      blocked: false,
      blocked_reason: null,
    };
    writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');

    addProject(slug, { path: projectPath, stack: 'other', has_deploy: false }, group || undefined);

    const sessionName = `${slug}-exploration`;
    try {
      const prompt = buildExploreIdeaPrompt({
        projectId: slug,
        projectPath,
        sprintDir,
        state,
        description: typeof description === 'string' ? description.slice(0, 1000) : undefined,
        toolId: state.tool_id,
      });
      launchSprintTool({
        sessionName,
        cwd: projectPath,
        toolId: state.tool_id,
        prompt,
        projectId: slug,
        featureId: state.feature,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(201).json({ projectId: slug, session: sessionName, path: projectPath, feature: 'feat-exploration' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings API (Phase 6 Atom 5) ---

// Env vars exposed to the settings UI (never expose secrets)
const SETTINGS_ALLOWLIST = ['NTFY_URL', 'NTFY_TOPIC', 'NTFY_ENABLED', 'BASE_URL', 'PORT'] as const;
const SETTINGS_SECRETS = ['AUTH_PASSPHRASE', 'AUTH_SECRET', 'NTFY_AUTH_TOKEN', 'COOKIE_MAX_AGE_HOURS'];

router.get('/settings', (_req, res) => {
  const settings: Record<string, string> = {};
  for (const key of SETTINGS_ALLOWLIST) {
    settings[key] = process.env[key] || '';
  }
  res.json(settings);
});

router.patch('/settings', (req, res) => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== 'object') {
    res.status(400).json({ error: 'Body must be a JSON object' });
    return;
  }

  // Block secret keys
  for (const key of Object.keys(updates)) {
    if (SETTINGS_SECRETS.includes(key)) {
      res.status(403).json({ error: `Cannot modify ${key} via API` });
      return;
    }
    if (!SETTINGS_ALLOWLIST.includes(key as any)) {
      res.status(400).json({ error: `Unknown setting: ${key}` });
      return;
    }
  }

  // Update in-memory env
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }

  // Persist to .env file
  try {
    const envPath = join(__dirname, '..', '.env');
    let envContent = '';
    if (existsSync(envPath)) {
      envContent = readFileSync(envPath, 'utf-8');
    }
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    }
    writeFileSync(envPath, envContent.trimStart());
    res.json({ ok: true, applied: updates });
  } catch (err: any) {
    // In-memory update succeeded, .env write failed
    res.status(500).json({ error: `Settings applied in memory but .env write failed: ${err.message}` });
  }
});

// --- Alerts API (Phase 6 Atom 4) ---

router.get('/alerts', (_req, res) => {
  const alerts: Array<{ type: string; message: string; sprintKey: string; severity: string; source: string; timestamp: string }> = [];
  const now = Date.now();

  try {
    const projects = getProjects();
    for (const project of projects) {
      const sprintsDir = join(project.path, '.sprints');
      if (!existsSync(sprintsDir)) continue;

      let entries;
      try { entries = readdirSync(sprintsDir, { withFileTypes: true }); } catch { continue; }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        let state: SprintState | null;
        try { state = readSprintState(join(sprintsDir, entry.name)); } catch { continue; }
        if (!state || state.phase === 'COMPLETE') continue;

        const key = `${project.id}-${state.feature}`;
        const lastActivity = getLastSprintActivity(state);
        const lastMs = new Date(lastActivity).getTime();

        if (state.blocked) {
          alerts.push({
            type: 'blocked',
            message: `${project.id}/${state.feature.replace(/^feat-/, '')} is blocked: ${state.blocked_reason || 'no reason given'}`,
            sprintKey: key,
            severity: 'high',
            source: 'sprint',
            timestamp: new Date().toISOString(),
          });
        } else if (isStaleSprintState(state, now)) {
          const hours = Math.round((now - lastMs) / 3600000);
          alerts.push({
            type: 'stale',
            message: `${project.id}/${state.feature.replace(/^feat-/, '')} has been idle for ${hours}h in ${state.phase}`,
            sprintKey: key,
            severity: 'medium',
            source: 'sprint',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } catch { /* ignore read errors */ }

  res.json(alerts);
});

// --- Archive API (Phase 6 Atom 2) ---

router.post('/sprints/:projectId/:featureId/archive', (req, res) => {
  const { projectId, featureId } = req.params;
  const project = getProjects().find((p) => p.id === projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) { res.status(404).json({ error: 'Sprint not found' }); return; }
  if (state.phase !== 'COMPLETE') { res.status(400).json({ error: 'Can only archive COMPLETE sprints' }); return; }

  writeSprintState(sprintDir, { ...state, archived: true } as any);
  res.json({ ok: true, archived: true });
});

router.delete('/sprints/:projectId/:featureId', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: 'Sprint not found' });
    return;
  }

  const tmuxSession = `${req.params.projectId}-${featureId.replace(/^feat-/, '')}`;

  try {
    deleteSprintArtifacts(project.path, featureId, tmuxSession);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete sprint' });
    return;
  }

  res.json({ ok: true, deleted: true, feature: featureId });
});

router.post('/sprints/:projectId/:featureId/remix', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const sprintDir = join(project.path, '.sprints', featureId);
  const state = readSprintState(sprintDir);
  if (!state) {
    res.status(404).json({ error: 'Sprint not found' });
    return;
  }

  const remix = buildSprintRemixPayload(state, req.params.projectId);
  const tmuxSession = `${req.params.projectId}-${featureId.replace(/^feat-/, '')}`;

  try {
    deleteSprintArtifacts(project.path, featureId, tmuxSession);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to remix sprint' });
    return;
  }

  res.json({ ok: true, remix });
});

export default router;
