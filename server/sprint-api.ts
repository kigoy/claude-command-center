import { Router } from 'express';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { getProjects, getGroups, addProject, updateProjectPath } from './sprint-config.js';
import { readSprintState, writeSprintState, deriveChainStatus, type SprintState, type ChainStatus } from './sprint-state.js';
import { resolveAtomCounts } from './sprint-atoms.js';
import { rankRecommendations, type SprintContext } from './sprint-recommendations.js';
import { buildRetroSummary, markRetroRun } from './sprint-retro.js';
import { buildAnalytics } from './sprint-analytics.js';
import { suggestSkills } from './sprint-suggestions.js';
import { getSprintSessions } from './tmux-detect.js';

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
  suggestions: string[];
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

/** Find a matching tmux session for a sprint from the cached background poller.
 *  Returns the session name if found, null otherwise. */
function findTmuxSession(projectId: string, feature: string): string | null {
  const featureBase = feature.replace(/^feat-/, '');
  for (const s of getSprintSessions()) {
    if (s.projectId === projectId && s.feature === featureBase) {
      return s.sessionName;
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
      const tmuxMatch = findTmuxSession(projectId, state.feature);
      const lastActivity = getLastActivity(state);
      const hasUi = state.qa_routing?.has_ui === true;
      sprints.push({
        feature: state.feature,
        phase: state.phase,
        blocked: state.blocked,
        blocked_reason: state.blocked_reason,
        atoms_total: atoms.total,
        atoms_completed: atoms.completed,
        has_atoms: atoms.has_atoms,
        last_activity: lastActivity,
        branch: state.branch,
        tmux_session: tmuxMatch ?? `${projectId}-${state.feature.replace(/^feat-/, '')}`,
        tmux_active: tmuxMatch !== null,
        chain_status: deriveChainStatus(state),
        suggestions: suggestSkills({
          feature: state.feature,
          phase: state.phase,
          blocked: state.blocked,
          last_activity: lastActivity,
          has_ui: hasUi,
        }),
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

    updateProjectPath(req.params.id, resolved);
    res.json({ ok: true, path: resolved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    phase_history: [{ phase: 'PLAN', entered: now }],
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
  const tmuxMatch = findTmuxSession(project.id, state.feature);

  res.json({
    ...state,
    atoms_total: atoms.total,
    atoms_completed: atoms.completed,
    has_atoms: atoms.has_atoms,
    tmux_session: tmuxMatch ?? `${project.id}-${state.feature.replace(/^feat-/, '')}`,
    tmux_active: tmuxMatch !== null,
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

/** Validate a command is safe to send to tmux — whitelist only. */
function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();
  if (ALLOWED_COMMANDS.has(trimmed)) return true;
  if (/^\/sprint\s+(new|switch|status|close|retro)\b/.test(trimmed)) return true;
  return false;
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

  const sessionName = `${req.params.projectId}-${featureId.replace(/^feat-/, '')}`;

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

  // Close current phase and open new phase — immutable update
  const updatedHistory = (state.phase_history as Array<Record<string, unknown>>).map((e) => {
    if (e.phase === state.phase && !e.exited) {
      const closed: Record<string, unknown> = { ...e, exited: now };
      if (summary && typeof summary === 'string') closed.summary = summary.slice(0, 1000);
      return closed;
    }
    return e;
  });
  updatedHistory.push({ phase: to_phase, entered: now });

  const updatedState: SprintState = { ...state, phase: to_phase, phase_history: updatedHistory };

  try {
    writeSprintState(sprintDir, updatedState);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to write STATE.json: ${err.message}` });
    return;
  }

  res.json({ phase: to_phase, chain_status: deriveChainStatus(updatedState) });
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

    res.status(201).json({ projectId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/explore-idea — explore in existing project or create new project */
router.post('/explore-idea', (req, res) => {
  const { name, description, group, projectId } = req.body;
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
      mkdirSync(sprintDir, { recursive: true });
      const now = new Date().toISOString();
      const state = {
        feature: dirName,
        branch: 'main',
        created: now,
        phase: 'PLAN',
        phase_history: [{ phase: 'PLAN', entered: now }],
        qa_routing: {},
        blocked: false,
        blocked_reason: null,
      };
      writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');

      // Open tmux session
      const sessionName = `${projectId}-${slug}`;
      try {
        execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', project.path], { stdio: 'ignore' });
        if (description) {
          execFileSync('tmux', ['send-keys', '-t', sessionName, '-l', 'claude']);
          execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter']);
          // Use load-buffer + paste-buffer to preserve newlines in multi-line descriptions
          setTimeout(() => {
            try {
              const prompt = `Read /Volumes/Extreme Pro/.gstack/skills/office-hours/SKILL.md and run office-hours on this idea:\n\n${description.slice(0, 500)}`;
              const tmpFile = join(tmpdir(), `explore-${Date.now()}.txt`);
              writeFileSync(tmpFile, prompt);
              execFileSync('tmux', ['load-buffer', tmpFile]);
              execFileSync('tmux', ['paste-buffer', '-t', sessionName]);
              execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter']);
              unlinkSync(tmpFile);
            } catch { /* ignore */ }
          }, 5000);
        }
      } catch { /* tmux not available */ }

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

    const sprintDir = join(projectPath, '.sprints', 'feat-exploration');
    mkdirSync(sprintDir, { recursive: true });
    const now = new Date().toISOString();
    const state = {
      feature: 'feat-exploration',
      branch: 'main',
      created: now,
      phase: 'PLAN',
      phase_history: [{ phase: 'PLAN', entered: now }],
      qa_routing: {},
      blocked: false,
      blocked_reason: null,
    };
    writeFileSync(join(sprintDir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');

    addProject(slug, { path: projectPath, stack: 'other', has_deploy: false }, group || undefined);

    const sessionName = `${slug}-exploration`;
    try {
      execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', projectPath], { stdio: 'ignore' });
      if (description) {
        execFileSync('tmux', ['send-keys', '-t', sessionName, '-l', 'claude']);
        execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter']);
        setTimeout(() => {
          try {
            const prompt = `Read /Volumes/Extreme Pro/.gstack/skills/office-hours/SKILL.md and run office-hours on this idea:\n\n${description.slice(0, 500)}`;
            const tmpFile = join(tmpdir(), `explore-${Date.now()}.txt`);
            writeFileSync(tmpFile, prompt);
            execFileSync('tmux', ['load-buffer', tmpFile]);
            execFileSync('tmux', ['paste-buffer', '-t', sessionName]);
            execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter']);
            unlinkSync(tmpFile);
          } catch { /* ignore */ }
        }, 5000);
      }
    } catch { /* tmux not available */ }

    res.status(201).json({ projectId: slug, session: sessionName, path: projectPath, feature: 'feat-exploration' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
