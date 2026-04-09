import type { Application } from 'express';
import { readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getSprintSessions } from '../tmux-detect.js';
import { getProjects } from '../sprint-config.js';
import { readSprintState } from '../sprint-state.js';
import { shouldExposeTmuxSession } from '../tmux-visibility.js';
import { handleTerminalInput, handleTerminalSSE } from '../terminal.js';

function getSprintStateForTmuxSession(projectId?: string, featureBase?: string) {
  if (!projectId || !featureBase) return null;
  const project = getProjects().find((entry) => entry.id === projectId);
  if (!project) return null;

  for (const featureId of [featureBase, `feat-${featureBase}`]) {
    const state = readSprintState(join(project.path, '.sprints', featureId));
    if (state) return state;
  }

  return null;
}

export function registerSystemRoutes(app: Application): void {
  app.get('/api/tmux-sessions', (_req, res) => {
    res.json(
      getSprintSessions().filter((session) =>
        shouldExposeTmuxSession(getSprintStateForTmuxSession(session.projectId, session.feature)),
      ),
    );
  });

  app.get('/api/repos', (_req, res) => {
    const devDir = join(homedir(), 'Developer');
    const repos: { name: string; path: string; mainPath: string }[] = [];
    try {
      const entries = readdirSync(devDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const repoDir = join(devDir, entry.name);
        const mainDir = join(repoDir, `${entry.name}-main`);
        if (existsSync(join(mainDir, '.git'))) {
          repos.push({ name: entry.name, path: repoDir, mainPath: mainDir });
        }
      }
    } catch {
      // ~/Developer may not exist
    }
    res.json({ repos: repos.sort((a, b) => a.name.localeCompare(b.name)) });
  });

  app.get('/api/browse', (req, res) => {
    const ALLOWED_BASE = '/Volumes/Extreme Pro';
    const rawPath = (req.query.path as string) || ALLOWED_BASE;
    const resolved = rawPath.startsWith('~')
      ? join(homedir(), rawPath.slice(1))
      : resolve(rawPath);

    if (!resolved.startsWith(ALLOWED_BASE)) {
      res.status(403).json({ error: 'Access denied — path outside allowed directory' });
      return;
    }

    try {
      const entries = readdirSync(resolved, { withFileTypes: true });
      const dirs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => {
          try {
            const stats = statSync(join(resolved, entry.name));
            return { name: entry.name, modified: stats.mtimeMs };
          } catch {
            return { name: entry.name, modified: 0 };
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ path: resolved, dirs });
    } catch {
      res.json({ path: resolved, dirs: [] });
    }
  });

  app.get('/api/terminal/:id/stream', handleTerminalSSE);
  app.post('/api/terminal/:id/input', handleTerminalInput);
}
