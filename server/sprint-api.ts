import { Router } from 'express';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { getProjects, getGroups } from './sprint-config.js';
import { readSprintState, writeSprintState, deriveChainStatus, type SprintState, type ChainStatus } from './sprint-state.js';
import { rankRecommendations, type SprintContext } from './sprint-recommendations.js';
import { buildRetroSummary, markRetroRun } from './sprint-retro.js';
import { buildAnalytics } from './sprint-analytics.js';

const router = Router();

/** Get the most recent timestamp from phase history, falling back to created date. */
function getLastActivity(state: SprintState): string {
  const history = state.phase_history as Array<{ exited?: string; entered?: string }>;
  if (history.length > 0) {
    const last = history[history.length - 1];
    return last.exited || last.entered || state.created;
  }
  return state.created;
}

// --- Types ---

interface SprintSummary {
  feature: string;
  phase: string;
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
}

interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  sprints: SprintSummary[];
}

// --- Helpers ---

/** Sanitize path segment to prevent directory traversal */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[\/\\\.]+/g, '').replace(/^\.+/, '');
}

/** Parse ATOMS.md to extract total/completed counts from per-atom status lines.
 *  Returns null when ATOMS.md does not exist (distinct from 0/0). */
function parseAtomCounts(sprintDir: string): { total: number; completed: number } | null {
  const atomsPath = join(sprintDir, 'ATOMS.md');
  try {
    const raw = readFileSync(atomsPath, 'utf-8');
    const statusLines = raw.match(/^- Status:\s*.+$/gm) || [];
    const total = statusLines.length;
    const statusCompleted = statusLines.filter(
      (line) => /\bDONE\b/i.test(line) || /\bCOMPLETE\b/i.test(line) || line.includes('\u2705'),
    ).length;
    // Also count heading-level checkmarks (e.g., "### Atom 1: title ✅")
    const headingCompleted = (raw.match(/^###\s+Atom\s+\d+:.+\u2705/gm) || []).length;
    return { total, completed: Math.max(statusCompleted, headingCompleted) };
  } catch {
    return null;
  }
}

/** Extract atom counts from STATE.json phase_history BUILD entry (fallback). */
function atomCountsFromState(state: SprintState): { total: number; completed: number } | null {
  const history = state.phase_history as Array<Record<string, unknown>>;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.phase === 'BUILD' && typeof entry.atoms_total === 'number') {
      return {
        total: entry.atoms_total as number,
        completed: (entry.atoms_completed as number) ?? 0,
      };
    }
  }
  return null;
}

/** Resolve atom counts: ATOMS.md first, then STATE.json fallback. */
function resolveAtomCounts(
  sprintDir: string,
  state: SprintState,
): { total: number; completed: number; has_atoms: boolean } {
  const fromFile = parseAtomCounts(sprintDir);
  if (!fromFile) {
    // No ATOMS.md — check STATE.json for historical counts
    const fromState = atomCountsFromState(state);
    return fromState
      ? { ...fromState, has_atoms: false }
      : { total: 0, completed: 0, has_atoms: false };
  }

  // ATOMS.md exists but shows 0 completed — fall back to STATE.json if available
  if (fromFile.completed === 0 && fromFile.total > 0) {
    const fromState = atomCountsFromState(state);
    if (fromState && fromState.completed > 0) {
      return { total: fromFile.total, completed: fromState.completed, has_atoms: true };
    }
  }

  return { ...fromFile, has_atoms: true };
}

/** Get active tmux session names. */
function getActiveTmuxSessions(): Set<string> {
  try {
    const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Derive the expected tmux session name for a sprint. */
function sprintTmuxName(projectId: string, feature: string): string {
  const name = feature.replace(/^feat-/, '');
  return `${projectId}-${name}`;
}

/** List all sprints for a project by reading its .sprints/ directory. */
function listSprintsForProject(
  projectId: string,
  projectPath: string,
  activeTmux: Set<string>,
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
          phase_history: [],
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
      const tmuxSession = sprintTmuxName(projectId, state.feature);
      sprints.push({
        feature: state.feature,
        phase: state.phase,
        blocked: state.blocked,
        blocked_reason: state.blocked_reason,
        atoms_total: atoms.total,
        atoms_completed: atoms.completed,
        has_atoms: atoms.has_atoms,
        last_activity: getLastActivity(state),
        branch: state.branch,
        tmux_session: tmuxSession,
        tmux_active: activeTmux.has(tmuxSession),
        chain_status: deriveChainStatus(state),
      });
    }
  } catch {
    // Can't read directory — return empty
  }
  return sprints;
}

// --- Shared ---

function buildProjectSummaries(): ProjectSummary[] {
  const activeTmux = getActiveTmuxSessions();
  return getProjects().map((p) => ({
    id: p.id,
    path: p.path,
    stack: p.stack,
    has_deploy: p.has_deploy,
    deploy_url: p.deploy_url,
    sprints: listSprintsForProject(p.id, p.path, activeTmux),
  }));
}

// --- Routes ---

/** GET /api/projects — all projects with sprint summaries */
router.get('/projects', (_req, res) => {
  res.json(buildProjectSummaries());
});

/** GET /api/projects/:id/sprints — sprints for a single project */
router.get('/projects/:id/sprints', (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.id}' not found` });
    return;
  }
  res.json(listSprintsForProject(project.id, project.path, getActiveTmuxSessions()));
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

/** POST /api/sprints — create a new sprint directory + STATE.json, open tmux session */
router.post('/sprints', (req, res) => {
  const { projectId, featureName } = req.body;
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
    phase_history: [{ entered: now }],
    qa_routing: {},
    blocked: false,
    blocked_reason: null,
  };

  try {
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
  } catch (err: any) {
    res.status(500).json({ error: `Failed to create sprint directory: ${err.message}` });
    return;
  }

  // Open a new tmux session in the project directory
  const sessionName = `${projectId}-${safeName}`;
  try {
    execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', project.path], {
      stdio: 'ignore',
    });
  } catch {
    // tmux may not be available or session name may conflict — non-fatal
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
      blocked: s.blocked,
      blocked_reason: s.blocked_reason,
      atoms_total: s.atoms_total,
      atoms_completed: s.atoms_completed,
      last_activity: s.last_activity,
    })),
  );

  const recommendations = rankRecommendations(allSprints, 3);

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
  const tmuxSession = sprintTmuxName(project.id, state.feature);
  const activeTmux = getActiveTmuxSessions();

  res.json({
    ...state,
    atoms_total: atoms.total,
    atoms_completed: atoms.completed,
    has_atoms: atoms.has_atoms,
    tmux_session: tmuxSession,
    tmux_active: activeTmux.has(tmuxSession),
    chain_status: deriveChainStatus(state),
  });
});

// --- Allowed sprint commands (whitelist) ---
const ALLOWED_COMMANDS = new Set([
  '/review', '/qa', '/qa-only', '/ship', '/document-release',
  '/retro', '/investigate', '/office-hours', '/plan-ceo-review',
  '/plan-eng-review', '/plan-design-review', '/browse', '/careful',
  '/freeze', '/guard', '/unfreeze', '/benchmark', '/canary',
]);

/** Validate a command is safe to send to tmux. */
function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();
  // Allow whitelisted slash commands
  if (ALLOWED_COMMANDS.has(trimmed)) return true;
  // Allow /sprint subcommands
  if (/^\/sprint\s+(new|switch|status|close|retro)\b/.test(trimmed)) return true;
  // Reject anything with shell metacharacters
  if (/[;&|`$(){}[\]<>!#]/.test(trimmed)) return false;
  // Allow simple text (for prompts/responses)
  return trimmed.length > 0 && trimmed.length < 500;
}

/** POST /api/sprints/:projectId/:featureId/exec — send command to sprint tmux session */
router.post('/sprints/:projectId/:featureId/exec', (req, res) => {
  const project = getProjects().find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
    return;
  }

  const featureId = sanitizeSegment(req.params.featureId);
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    res.status(400).json({ error: 'command is required' });
    return;
  }

  if (!isCommandSafe(command)) {
    res.status(400).json({ error: 'Command contains disallowed characters' });
    return;
  }

  const sessionName = sprintTmuxName(req.params.projectId, featureId);

  // Check if tmux session exists, create if not
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
  } catch {
    // Session doesn't exist — create it
    try {
      execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', project.path], {
        stdio: 'ignore',
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to create tmux session: ${err.message}` });
      return;
    }
  }

  // Send command via send-keys
  try {
    execFileSync('tmux', ['send-keys', '-t', sessionName, '-l', command.trim()]);
    execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter']);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to send command: ${err.message}` });
    return;
  }

  res.json({ session: sessionName, command: command.trim(), sent: true });
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

  const now = new Date().toISOString();

  // Close current phase in history
  const history = state.phase_history as Array<Record<string, unknown>>;
  const currentEntry = history.find((e) => e.phase === state.phase && !e.exited);
  if (currentEntry) {
    currentEntry.exited = now;
    if (summary) currentEntry.summary = summary;
  }

  // Open new phase
  history.push({ phase: to_phase, entered: now });
  state.phase = to_phase;

  try {
    writeSprintState(sprintDir, state);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to write STATE.json: ${err.message}` });
    return;
  }

  res.json({ phase: to_phase, chain_status: deriveChainStatus(state) });
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

export default router;
