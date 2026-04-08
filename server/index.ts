import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { createHash } from 'crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { login, authMiddleware, COOKIE_NAME, MAX_AGE_HOURS } from './auth.js';
import { createSession, listSessions, killSession, refreshSession, getSession } from './sessions.js';
import { getSession as getSessionFromDb, setRocketMode, renameSession } from './db.js';
import { syncSessionsWithTmux } from './sessions.js';
import { setupTerminalWs, handleTerminalSSE, handleTerminalInput } from './terminal.js';
import { sendInput } from './input.js';
import { notifyWaiting } from './notifier.js';
import { startStatusPolling } from './status.js';
import { createRequest, getRequest, setResponse, getResponse, listRequests } from './mcp-responses.js';
import sprintApi from './sprint-api.js';
import batchApi from './batch-api.js';
import { setupSprintSSE } from './sprint-sse.js';
import { setupBatchEvents } from './batch-events.js';
import { setupTerminalSnippets } from './terminal-snippets.js';
import { startTmuxDetection, getSprintSessions } from './tmux-detect.js';
import { startSprintNotifications } from './sprint-notifications.js';
import { getProjects } from './sprint-config.js';
import {
  seedBuiltInCliTools,
  listCliTools,
  getCliTool,
  createCliTool,
  updateCliTool,
  setCliToolEnabled,
  reorderCliTools,
  duplicateCliTool,
} from './cli-tools.js';
import { getToolDisplayLabel } from './session-runtime.js';
import { ensureProjectInstructionFiles } from './project-instructions.js';
import { markOrphanedLaunchingRows } from './batch-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3100', 10);

const app = express();
app.use(express.json());
app.use(cookieParser());

for (const project of getProjects()) {
  try {
    ensureProjectInstructionFiles(project.path);
  } catch (err) {
    console.warn(`[instructions] Failed to sync instructions for ${project.id}: ${err}`);
  }
}

function serializeSession(session: ReturnType<typeof getSessionFromDb>) {
  if (!session) return null;
  const tool = getCliTool(session.tool_id);
  return {
    ...session,
    toolId: session.tool_id,
    toolLabel: getToolDisplayLabel(session.tool_id, tool),
    tool: tool ? {
      id: tool.id,
      label: tool.label,
      enabled: tool.enabled,
      builtIn: tool.builtIn,
    } : null,
  };
}

// Token auth for ntfy action buttons (before cookie auth middleware)
app.post('/api/sessions/:id/input', (req, res, next) => {
  const token = req.query.token as string;
  if (token && process.env.NTFY_AUTH_TOKEN && token === process.env.NTFY_AUTH_TOKEN) {
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
    return;
  }
  next();
});

// --- MCP response endpoints (token auth, before cookie auth middleware) ---

// MCP server polls this to check for user responses
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

// ntfy action buttons POST here with a pre-selected response
app.post('/api/mcp/respond', (req, res, next) => {
  const token = req.query.token as string;
  if (token && process.env.NTFY_AUTH_TOKEN && token === process.env.NTFY_AUTH_TOKEN) {
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
    return;
  }
  next(); // Fall through to cookie-authed version below
});

// Store a pending ask_user request (called by MCP server)
app.post('/api/mcp/requests', (req, res) => {
  const token = req.query.token as string;
  if (!token || !process.env.NTFY_AUTH_TOKEN || token !== process.env.NTFY_AUTH_TOKEN) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const { requestId, sessionId, question, options, allowText } = req.body;
  if (!requestId || !question) {
    res.status(400).json({ error: 'requestId and question are required' });
    return;
  }
  createRequest(requestId, sessionId || '', question, options || [], allowText ?? true);
  res.status(201).json({ ok: true });
});

// Get request details (for the response web page — token or cookie auth)
app.get('/api/mcp/requests/:requestId', (req, res, next) => {
  const token = req.query.token as string;
  if (token && process.env.NTFY_AUTH_TOKEN && token === process.env.NTFY_AUTH_TOKEN) {
    const request = getRequest(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'Request not found or expired' });
      return;
    }
    const { response, createdAt, ...safe } = request;
    res.json(safe);
    return;
  }
  next(); // Fall through to cookie-authed version below
});

// Hook-triggered notification endpoint (token auth, called by notify-hook.sh)
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

// --- Rocket mode check (token auth, called by PreToolUse hook) ---

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

// --- Version (for "new version available" detection, no auth needed) ---

const indexHtmlPath = join(__dirname, '..', 'frontend', 'dist', 'index.html');
let buildHash = '';
try {
  buildHash = createHash('md5').update(readFileSync(indexHtmlPath)).digest('hex').slice(0, 8);
} catch {
  // No build yet (dev mode)
}
app.get('/api/version', (_req, res) => res.json({ hash: buildHash }));

// Auth middleware for API routes
app.use('/api', authMiddleware);

// --- Auth ---

app.post('/api/auth/login', async (req, res) => {
  const { passphrase } = req.body;
  const token = await login(passphrase);

  if (!token) {
    res.status(401).json({ error: 'Invalid passphrase' });
    return;
  }

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: MAX_AGE_HOURS * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/auth/check', (_req, res) => {
  res.json({ ok: true });
});

// --- MCP (cookie-authed, for web response page) ---

app.get('/api/mcp/requests', (_req, res) => {
  const requests = listRequests().map((request) => {
    const session = request.sessionId ? getSessionFromDb(request.sessionId) : null;
    return {
      requestId: request.requestId,
      sessionId: request.sessionId,
      question: request.question,
      options: request.options,
      allowText: request.allowText,
      createdAt: request.createdAt,
      sessionName: session?.name ?? null,
      toolId: session?.tool_id ?? null,
    };
  });

  res.json(requests);
});

app.get('/api/mcp/requests/:requestId', (req, res) => {
  const request = getRequest(req.params.requestId);
  if (!request) {
    res.status(404).json({ error: 'Request not found or expired' });
    return;
  }
  const { response, createdAt, ...safe } = request;
  res.json(safe);
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

// --- CLI Tools ---

app.get('/api/cli-tools', (req, res) => {
  const enabledOnly = req.query.enabledOnly === '1';
  res.json(listCliTools({ enabledOnly }));
});

app.get('/api/cli-tools/:id', (req, res) => {
  const tool = getCliTool(req.params.id);
  if (!tool) {
    res.status(404).json({ error: 'CLI tool not found' });
    return;
  }
  res.json(tool);
});

app.post('/api/cli-tools', (req, res) => {
  try {
    const tool = createCliTool(req.body);
    res.status(201).json(tool);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/cli-tools/reorder', (req, res) => {
  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : null;
  if (!orderedIds) {
    res.status(400).json({ error: 'orderedIds is required' });
    return;
  }
  try {
    res.json(reorderCliTools(orderedIds));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/cli-tools/:id/duplicate', (req, res) => {
  try {
    res.status(201).json(duplicateCliTool(req.params.id));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.patch('/api/cli-tools/:id/enabled', (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  try {
    res.json(setCliToolEnabled(req.params.id, req.body.enabled));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.patch('/api/cli-tools/:id', (req, res) => {
  try {
    res.json(updateCliTool(req.params.id, req.body));
  } catch (err: any) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// --- Sprint Command API ---

app.use('/api', sprintApi);

// --- Batch API ---

app.use('/api', batchApi);

// --- Sprint SSE (live updates) ---

setupSprintSSE(app);

// --- Batch Events SSE (dedicated batch-state invalidation channel) ---

setupBatchEvents(app);

// --- Terminal Snippets SSE (mini-previews for board cards) ---

setupTerminalSnippets(app);

// --- Tmux Sprint Sessions ---

app.get('/api/tmux-sessions', (_req, res) => {
  res.json(getSprintSessions());
});

// --- Sessions ---

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
  const {
    name,
    cwd,
    toolId,
    worktreePath,
    initialPrompt,
    repo,
    rocketMode,
    tmuxSession,
    bootstrapCommand,
  } = req.body;

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
    if (!payload) {
      throw new Error('Failed to load created session');
    }
    res.status(201).json({
      ...payload,
      rocket_mode: rocketMode ? 1 : session.rocket_mode,
    });
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

// --- Repos (scan ~/Developer for worktree-structured repos) ---

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

// --- Quick input (sends keys to tmux directly, no pty needed) ---

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

// --- Directory browser ---

app.get('/api/browse', (req, res) => {
  const ALLOWED_BASE = '/Volumes/Extreme Pro';
  const rawPath = (req.query.path as string) || ALLOWED_BASE;
  const resolved = rawPath.startsWith('~')
    ? join(homedir(), rawPath.slice(1))
    : resolve(rawPath);

  // Guard: only allow browsing within the allowed base directory
  if (!resolved.startsWith(ALLOWED_BASE)) {
    res.status(403).json({ error: 'Access denied — path outside allowed directory' });
    return;
  }

  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        try {
          const st = statSync(join(resolved, e.name));
          return { name: e.name, modified: st.mtimeMs };
        } catch {
          return { name: e.name, modified: 0 };
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ path: resolved, dirs });
  } catch {
    res.json({ path: resolved, dirs: [] });
  }
});

// --- Terminal SSE fallback (for slow networks where WS upgrade stalls) ---

app.get('/api/terminal/:id/stream', handleTerminalSSE);
app.post('/api/terminal/:id/input', handleTerminalInput);

// --- Static files (production) ---

const frontendDist = join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res, next) => {
  // Only serve index.html for non-API routes
  if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// --- Start ---

const server = createServer(app);
setupTerminalWs(server);

// Sync existing tmux sessions on startup
seedBuiltInCliTools();
const recoveredLaunchRows = markOrphanedLaunchingRows();
if (recoveredLaunchRows > 0) {
  console.warn(`[batch] Marked ${recoveredLaunchRows} orphaned launching row(s) as interrupted`);
}
syncSessionsWithTmux();
startStatusPolling();
startTmuxDetection();

server.listen(PORT, () => {
  console.log(`Sprint Command Center running on http://localhost:${PORT}`);
  startSprintNotifications();
});
