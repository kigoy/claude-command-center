import { type Express, type Request, type Response } from 'express';
import { watch, type FSWatcher, readFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { getProjects, type ProjectConfig } from './sprint-config.js';
import { readSprintState, deriveChainStatus } from './sprint-state.js';

// --- Types ---

interface SSEClient {
  id: number;
  res: Response;
}

interface SprintUpdatePayload {
  projectId: string;
  feature: string;
  sprint: Record<string, unknown>;
}

// --- State ---

let clientIdCounter = 0;
const clients: SSEClient[] = [];
const watchers: FSWatcher[] = [];
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// --- Helpers ---

/** Parse ATOMS.md for counts (mirrors sprint-api logic). */
function parseAtomCounts(sprintDir: string): { total: number; completed: number } | null {
  const atomsPath = join(sprintDir, 'ATOMS.md');
  try {
    const raw = readFileSync(atomsPath, 'utf-8');
    const statusLines = raw.match(/^- Status:\s*.+$/gm) || [];
    const total = statusLines.length;
    const completed = statusLines.filter(
      (line) => /\bDONE\b/i.test(line) || /\bCOMPLETE\b/i.test(line) || line.includes('\u2705'),
    ).length;
    const headingCompleted = (raw.match(/^###\s+Atom\s+\d+:.+\u2705/gm) || []).length;
    return { total, completed: Math.max(completed, headingCompleted) };
  } catch {
    return null;
  }
}

/** Build a sprint summary from a sprint directory. */
function buildSprintPayload(projectId: string, sprintDir: string): SprintUpdatePayload | null {
  const state = readSprintState(sprintDir);
  if (!state) return null;

  const atoms = parseAtomCounts(sprintDir);
  return {
    projectId,
    feature: state.feature,
    sprint: {
      feature: state.feature,
      phase: state.phase,
      blocked: state.blocked,
      blocked_reason: state.blocked_reason,
      atoms_total: atoms?.total ?? 0,
      atoms_completed: atoms?.completed ?? 0,
      has_atoms: atoms !== null,
      branch: state.branch,
      chain_status: deriveChainStatus(state),
    },
  };
}

/** Broadcast an SSE event to all connected clients. */
function broadcast(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].res.write(message);
    } catch {
      clients.splice(i, 1);
    }
  }
}

/** Handle a file change with debouncing. */
function handleFileChange(project: ProjectConfig, sprintDir: string): void {
  const key = sprintDir;
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      const payload = buildSprintPayload(project.id, sprintDir);
      if (payload) broadcast('sprint-update', payload);
    }, 100),
  );
}

/** Start watching a single .sprints/ directory. */
function watchSprintsDir(project: ProjectConfig): void {
  const sprintsDir = join(project.path, '.sprints');
  if (!existsSync(sprintsDir)) return;

  try {
    const watcher = watch(sprintsDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const base = basename(filename);
      if (base !== 'STATE.json' && base !== 'ATOMS.md') return;

      // filename is relative to sprintsDir, e.g. "feat-foo/STATE.json"
      const featureDir = dirname(filename);
      const sprintDir = join(sprintsDir, featureDir);
      handleFileChange(project, sprintDir);
    });
    watchers.push(watcher);
  } catch (err) {
    console.warn(`[sprint-sse] Failed to watch ${sprintsDir}: ${err}`);
  }
}

// --- Keepalive ---

let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepalive(): void {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    const comment = `: keepalive ${Date.now()}\n\n`;
    for (let i = clients.length - 1; i >= 0; i--) {
      try {
        clients[i].res.write(comment);
      } catch {
        clients.splice(i, 1);
      }
    }
  }, 15_000);
}

// --- Public API ---

export function setupSprintSSE(app: Express): void {
  // Start file watchers for all project .sprints/ directories
  for (const project of getProjects()) {
    watchSprintsDir(project);
  }
  startKeepalive();
  console.log(`[sprint-sse] Watching ${watchers.length} sprint directories`);

  app.get('/api/sprint-events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const client: SSEClient = { id: ++clientIdCounter, res };
    clients.push(client);

    req.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });
  });
}
