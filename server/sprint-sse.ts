import { type Express, type Request, type Response } from 'express';
import { watch, type FSWatcher, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { getProjects, type ProjectConfig } from './sprint-config.js';
import { readSprintState, deriveChainStatus } from './sprint-state.js';
import { parseAtomCounts } from './sprint-atoms.js';

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
let watchersStarted = false;

// --- Helpers ---

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

/** Track watched sprint subdirs to avoid duplicate watchers */
const watchedDirs = new Set<string>();

/** Watch a specific sprint feature directory for STATE.json / ATOMS.md changes. */
function watchFeatureDir(project: ProjectConfig, sprintDir: string): void {
  if (watchedDirs.has(sprintDir) || !existsSync(sprintDir)) return;
  watchedDirs.add(sprintDir);

  try {
    const watcher = watch(sprintDir, (_event, filename) => {
      if (!filename) return;
      if (filename !== 'STATE.json' && filename !== 'ATOMS.md') return;
      handleFileChange(project, sprintDir);
    });
    watchers.push(watcher);
  } catch (err) {
    console.warn(`[sprint-sse] Failed to watch ${sprintDir}: ${err}`);
  }
}

/** Start watching a .sprints/ directory. Watches existing subdirs and detects new ones. */
function watchSprintsDir(project: ProjectConfig): void {
  const sprintsDir = join(project.path, '.sprints');
  if (!existsSync(sprintsDir)) return;

  // Watch existing feature dirs
  try {
    const { readdirSync } = require('fs');
    const entries = readdirSync(sprintsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('_')) {
        watchFeatureDir(project, join(sprintsDir, entry.name));
      }
    }
  } catch { /* ignore */ }

  // Watch the parent .sprints/ dir for new subdirectories
  try {
    const parentWatcher = watch(sprintsDir, (event, filename) => {
      if (!filename || event !== 'rename') return;
      const newDir = join(sprintsDir, filename);
      if (existsSync(newDir)) watchFeatureDir(project, newDir);
    });
    watchers.push(parentWatcher);
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
  keepaliveInterval.unref?.();
}

function stopKeepalive(): void {
  if (!keepaliveInterval) return;
  clearInterval(keepaliveInterval);
  keepaliveInterval = null;
}

function startWatchingProjects(): void {
  if (watchersStarted) return;
  for (const project of getProjects()) {
    watchSprintsDir(project);
  }
  watchersStarted = true;
  console.log(`[sprint-sse] Watching ${watchers.length} sprint directories`);
}

function stopWatchingProjects(): void {
  if (!watchersStarted) return;
  for (const watcher of watchers) {
    watcher.close();
  }
  watchers.length = 0;
  watchedDirs.clear();
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  watchersStarted = false;
}

// --- Public API ---

export function setupSprintSSE(app: Express): void {
  app.get('/api/sprint-events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    startWatchingProjects();
    startKeepalive();

    const client: SSEClient = { id: ++clientIdCounter, res };
    clients.push(client);

    req.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
      if (clients.length === 0) {
        stopKeepalive();
        stopWatchingProjects();
      }
    });
  });
}
