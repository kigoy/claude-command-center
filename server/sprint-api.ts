import { Router } from 'express';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getProjects } from './sprint-config.js';
import { readSprintState, type SprintState } from './sprint-state.js';

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
  last_activity: string;
  branch: string;
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

/** Parse ATOMS.md header to extract total/completed counts. */
function parseAtomCounts(sprintDir: string): { total: number; completed: number } {
  const atomsPath = join(sprintDir, 'ATOMS.md');
  try {
    const raw = readFileSync(atomsPath, 'utf-8');
    // Look for "- Total: N" and "- Completed: N" in the status section
    const totalMatch = raw.match(/- Total:\s*(\d+)/);
    const completedMatch = raw.match(/- Completed:\s*(\d+)/);
    return {
      total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
      completed: completedMatch ? parseInt(completedMatch[1], 10) : 0,
    };
  } catch {
    return { total: 0, completed: 0 };
  }
}

/** List all sprints for a project by reading its .sprints/ directory. */
function listSprintsForProject(projectPath: string): SprintSummary[] {
  const sprintsDir = join(projectPath, '.sprints');
  if (!existsSync(sprintsDir)) return [];

  const sprints: SprintSummary[] = [];
  try {
    const entries = readdirSync(sprintsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const featureDir = join(sprintsDir, entry.name);
      const state = readSprintState(featureDir);
      if (!state) continue;

      const atoms = parseAtomCounts(featureDir);
      sprints.push({
        feature: state.feature,
        phase: state.phase,
        blocked: state.blocked,
        blocked_reason: state.blocked_reason,
        atoms_total: atoms.total,
        atoms_completed: atoms.completed,
        last_activity: getLastActivity(state),
        branch: state.branch,
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
    sprints: listSprintsForProject(p.path),
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
  res.json(listSprintsForProject(project.path));
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

/** GET /api/dashboard — combined view: all projects, all sprints, recommendation */
router.get('/dashboard', (_req, res) => {
  const dashboard = buildProjectSummaries();

  // Build recommendation: prioritize by phase (BUILD > REVIEW > QA > PLAN)
  const phasePriority: Record<string, number> = {
    BUILD: 1, REVIEW: 2, QA: 3, SHIP: 4, PLAN: 5, COMPLETE: 99,
  };

  let recommendation = '';
  let bestPriority = 100;

  for (const project of dashboard) {
    for (const sprint of project.sprints) {
      const priority = phasePriority[sprint.phase] ?? 50;
      if (priority < bestPriority && sprint.phase !== 'COMPLETE') {
        bestPriority = priority;
        recommendation = `Continue ${project.id}/${sprint.feature} (${sprint.phase}, ${sprint.atoms_completed}/${sprint.atoms_total} atoms)`;
      }
    }
  }

  res.json({ projects: dashboard, recommendation });
});

export default router;
