import type { Application } from 'express';
import { join } from 'path';
import {
  createRequest,
  getRequest,
  getResponse,
  listRequests,
  setResponse,
} from '../mcp-responses.js';
import { getSession as getSessionFromDb } from '../db.js';
import { getProjects } from '../sprint-config.js';
import { readSprintState } from '../sprint-state.js';
import { isRecommendedAutomationEnabled } from '../sprint-automation.js';

function getSprintStateForRequest(projectId?: string, featureId?: string) {
  if (!projectId || !featureId) return null;
  const project = getProjects().find((entry) => entry.id === projectId);
  if (!project) return null;
  return readSprintState(join(project.path, '.sprints', featureId));
}

function serializePendingRequest(request: ReturnType<typeof getRequest>) {
  if (!request) return null;
  const session = request.sessionId ? getSessionFromDb(request.sessionId) : null;
  const sprintState = getSprintStateForRequest(request.projectId, request.featureId);
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    question: request.question,
    options: request.options,
    allowText: request.allowText,
    createdAt: request.createdAt,
    sessionName: session?.name || request.tmuxSession || null,
    toolId: session?.tool_id ?? sprintState?.tool_id ?? null,
    projectId: request.projectId ?? null,
    featureId: request.featureId ?? null,
    automationEnabled: sprintState ? isRecommendedAutomationEnabled(sprintState) : false,
  };
}

export function registerMcpTokenRoutes(app: Application): void {
  app.get('/api/mcp/responses/:requestId', (req, res) => {
    const token = req.query.token as string;
    if (!token || !process.env.NTFY_AUTH_TOKEN || token !== process.env.NTFY_AUTH_TOKEN) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    const response = getResponse(req.params.requestId);
    if (response === undefined) {
      res.status(204).end();
      return;
    }
    res.json({ response });
  });

  app.post('/api/mcp/respond', (req, res, next) => {
    const token = req.query.token as string;
    if (!(token && process.env.NTFY_AUTH_TOKEN && token === process.env.NTFY_AUTH_TOKEN)) {
      next();
      return;
    }

    const { requestId, response } = req.body;
    if (!requestId || !response) {
      res.status(400).json({ error: 'requestId and response are required' });
      return;
    }
    const ok = setResponse(requestId, response);
    if (!ok) {
      res.status(404).json({ error: 'Request not found or expired' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/mcp/requests', (req, res) => {
    const token = req.query.token as string;
    if (!token || !process.env.NTFY_AUTH_TOKEN || token !== process.env.NTFY_AUTH_TOKEN) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { requestId, sessionId, tmuxSession, projectId, featureId, question, options, allowText } = req.body;
    if (!requestId || !question) {
      res.status(400).json({ error: 'requestId and question are required' });
      return;
    }

    createRequest(requestId, sessionId || '', question, options || [], allowText ?? true, {
      tmuxSession: typeof tmuxSession === 'string' ? tmuxSession : '',
      projectId: typeof projectId === 'string' ? projectId : '',
      featureId: typeof featureId === 'string' ? featureId : '',
    });

    const sprintState = getSprintStateForRequest(
      typeof projectId === 'string' ? projectId : '',
      typeof featureId === 'string' ? featureId : '',
    );
    if (sprintState && isRecommendedAutomationEnabled(sprintState) && Array.isArray(options) && options[0]) {
      setResponse(requestId, options[0]);
      res.status(201).json({ ok: true, autoAnswered: true, response: options[0] });
      return;
    }

    res.status(201).json({ ok: true });
  });

  app.get('/api/mcp/requests/:requestId', (req, res, next) => {
    const token = req.query.token as string;
    if (!(token && process.env.NTFY_AUTH_TOKEN && token === process.env.NTFY_AUTH_TOKEN)) {
      next();
      return;
    }

    const request = getRequest(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'Request not found or expired' });
      return;
    }
    res.json(serializePendingRequest(request));
  });
}

export function registerMcpRoutes(app: Application): void {
  app.get('/api/mcp/requests', (_req, res) => {
    res.json(listRequests().map((request) => serializePendingRequest(request)));
  });

  app.get('/api/mcp/requests/:requestId', (req, res) => {
    const request = getRequest(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'Request not found or expired' });
      return;
    }
    res.json(serializePendingRequest(request));
  });

  app.post('/api/mcp/respond', (req, res) => {
    const { requestId, response } = req.body;
    if (!requestId || !response) {
      res.status(400).json({ error: 'requestId and response are required' });
      return;
    }
    const ok = setResponse(requestId, response);
    if (!ok) {
      res.status(404).json({ error: 'Request not found or expired' });
      return;
    }
    res.json({ ok: true });
  });
}
