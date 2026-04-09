import type { Application } from 'express';
import {
  createSession,
  getSession,
  killSession,
  listSessions,
  refreshSession,
} from '../sessions.js';
import { getSession as getSessionFromDb, renameSession, setRocketMode } from '../db.js';
import { getCliTool } from '../cli-tools.js';
import { getToolDisplayLabel } from '../session-runtime.js';
import { sendInput } from '../input.js';
import { notifyWaiting } from '../notifier.js';

function serializeSession(session: ReturnType<typeof getSessionFromDb>) {
  if (!session) return null;
  const tool = getCliTool(session.tool_id);
  return {
    ...session,
    toolId: session.tool_id,
    toolLabel: getToolDisplayLabel(session.tool_id, tool),
    tool: tool
      ? {
          id: tool.id,
          label: tool.label,
          enabled: tool.enabled,
          builtIn: tool.builtIn,
        }
      : null,
  };
}

export function registerSessionTokenRoutes(app: Application): void {
  app.post('/api/sessions/:id/input', (req, res, next) => {
    const token = req.query.token as string;
    if (!(token && process.env.NTFY_AUTH_TOKEN && token === process.env.NTFY_AUTH_TOKEN)) {
      next();
      return;
    }

    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const success = sendInput(req.params.id, text);
    if (!success) {
      res.status(404).json({ error: 'Session not found or dead' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/sessions/:id/notify', (req, res) => {
    const token = req.query.token as string;
    if (!token || !process.env.NTFY_AUTH_TOKEN || token !== process.env.NTFY_AUTH_TOKEN) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const { tool_name, tool_input } = req.body;
    notifyWaiting(session.id, session.name, { tool_name, tool_input });
    res.json({ ok: true });
  });

  app.get('/api/sessions/:id/rocket', (req, res) => {
    const token = req.query.token as string;
    if (!token || !process.env.NTFY_AUTH_TOKEN || token !== process.env.NTFY_AUTH_TOKEN) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    const session = getSessionFromDb(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ rocket_mode: !!session.rocket_mode });
  });
}

export function registerSessionRoutes(app: Application): void {
  app.get('/api/sessions', (_req, res) => {
    res.json(listSessions().map((session) => serializeSession(session)));
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(serializeSession(session));
  });

  app.post('/api/sessions', (req, res) => {
    const { name, cwd, toolId, worktreePath, initialPrompt, repo, rocketMode, tmuxSession, bootstrapCommand } = req.body;
    if (!name || !cwd) {
      res.status(400).json({ error: 'name and cwd are required' });
      return;
    }

    try {
      const session = createSession(name, cwd, {
        toolId,
        worktreePath,
        initialPrompt,
        repo,
        tmuxSession,
        bootstrapCommand,
      });
      if (rocketMode) setRocketMode(session.id, true);
      const payload = serializeSession(getSessionFromDb(session.id));
      if (!payload) throw new Error('Failed to load created session');
      res.status(201).json({ ...payload, rocket_mode: rocketMode ? 1 : session.rocket_mode });
    } catch (err: any) {
      const status = /CLI tool/i.test(err.message) ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/sessions/:id', (req, res) => {
    const success = killSession(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/sessions/:id/refresh', (req, res) => {
    const success = refreshSession(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Session not found or dead' });
      return;
    }
    res.json({ ok: true });
  });

  app.patch('/api/sessions/:id/name', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    const session = getSessionFromDb(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    renameSession(req.params.id, name.trim());
    res.json({ ok: true });
  });

  app.post('/api/sessions/:id/rocket', (req, res) => {
    const session = getSessionFromDb(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const enabled = !session.rocket_mode;
    setRocketMode(req.params.id, enabled);
    res.json({ rocket_mode: enabled });
  });

  app.post('/api/sessions/:id/input', (req, res) => {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const success = sendInput(req.params.id, text);
    if (!success) {
      res.status(404).json({ error: 'Session not found or dead' });
      return;
    }
    res.json({ ok: true });
  });
}
