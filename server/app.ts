/**
 * Express app factory.
 *
 * createApp() returns a fully configured Express application with all routes
 * mounted, but does NOT bind to a port or start any background services.
 * This allows the app to be imported by tests (Supertest) without side effects.
 *
 * Background services (status polling, tmux detection, etc.) are started
 * separately in server/index.ts.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { login, authMiddleware, COOKIE_NAME, MAX_AGE_HOURS } from './auth.js';
import sprintApi from './sprint-api.js';
import batchApi from './batch-api.js';
import { setupSprintSSE } from './sprint-sse.js';
import { setupBatchEvents } from './batch-events.js';
import { setupTerminalSnippets } from './terminal-snippets.js';
import { registerCliToolRoutes } from './routes/cli-tool-routes.js';
import { registerMcpRoutes, registerMcpTokenRoutes } from './routes/mcp-routes.js';
import { registerSessionRoutes, registerSessionTokenRoutes } from './routes/session-routes.js';
import { registerSystemRoutes } from './routes/system-routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // --- Token auth endpoints (before cookie auth middleware) ---

  registerSessionTokenRoutes(app);
  registerMcpTokenRoutes(app);

  // --- Version (no auth needed) ---

  const indexHtmlPath = join(__dirname, '..', 'frontend', 'dist', 'index.html');
  let buildHash = '';
  try {
    buildHash = createHash('md5').update(readFileSync(indexHtmlPath)).digest('hex').slice(0, 8);
  } catch {
    // No build yet (dev mode)
  }
  app.get('/api/version', (_req, res) => res.json({ hash: buildHash }));

  // --- Auth middleware for API routes ---

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

  // --- MCP (cookie-authed) ---

  registerMcpRoutes(app);

  // --- CLI Tools ---

  registerCliToolRoutes(app);

  // --- Sprint Command API ---

  app.use('/api', sprintApi);

  // --- Batch API ---

  app.use('/api', batchApi);

  // --- Sprint SSE (live updates) ---

  setupSprintSSE(app);

  // --- Batch Events SSE (dedicated batch-state invalidation channel) ---

  setupBatchEvents(app);

  // --- Terminal Snippets SSE ---

  setupTerminalSnippets(app);

  // --- Sessions and system routes ---

  registerSessionRoutes(app);
  registerSystemRoutes(app);

  // --- Static files (production) ---

  const frontendDist = join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(join(frontendDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  return app;
}
