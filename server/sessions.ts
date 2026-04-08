import { execSync, execFileSync } from 'child_process';
import { basename, dirname, join } from 'path';
import { nanoid } from 'nanoid';
import {
  insertSession,
  getAllSessions,
  getSession,
  updateSessionStatus,
  removeSession,
  setSessionMeta,
  setTmuxName,
  type Session,
} from './db.js';
import { sendInput } from './input.js';
import { getCliTool, listCliTools } from './cli-tools.js';
import {
  getSessionTmuxName,
  launchToolInTmux,
  respawnSessionPane,
  shouldSendPromptOverStdin,
  tmuxSessionExists,
} from './session-runtime.js';

interface CreateSessionOpts {
  toolId?: string;
  worktreePath?: string;
  initialPrompt?: string;
  repo?: string;
  tmuxSession?: string;
  bootstrapCommand?: string;
}

function resolveLaunchTool(toolId?: string) {
  const effectiveToolId = toolId || 'claude';
  const tool = getCliTool(effectiveToolId);
  if (!tool) {
    throw new Error(`CLI tool '${effectiveToolId}' is missing`);
  }
  if (!tool.enabled) {
    throw new Error(`CLI tool '${effectiveToolId}' is disabled`);
  }
  return tool;
}

function queueInitialPrompt(sessionId: string, toolId: string, prompt?: string) {
  const tool = getCliTool(toolId);
  if (!tool || !shouldSendPromptOverStdin(tool, prompt)) return;
  setTimeout(() => sendInput(sessionId, prompt!), 5000);
}

/** Create a new session in tmux from a stored CLI tool definition. */
export function createSession(
  name: string,
  cwd: string,
  opts?: CreateSessionOpts,
): Session {
  const toolId = opts?.toolId || 'claude';

  // Reuse existing running session with the same name.
  const all = getAllSessions();
  for (const existing of all) {
    if (existing.name !== name || existing.status !== 'running') continue;
    const tmux = getSessionTmuxName(existing);
    if (tmuxSessionExists(tmux)) return existing;
    updateSessionStatus(existing.id, 'dead');
  }

  const id = nanoid(10);

  if (opts?.tmuxSession) {
    if (!tmuxSessionExists(opts.tmuxSession)) {
      const tool = resolveLaunchTool(toolId);
      launchToolInTmux({
        tmuxName: opts.tmuxSession,
        cwd,
        tool,
        bootstrapCommand: opts.bootstrapCommand,
        prompt: opts.initialPrompt,
        extraEnv: {
          CC_SESSION_ID: id,
          CC_SESSION_NAME: name,
          CC_TMUX_SESSION: opts.tmuxSession,
        },
      });
    }

    insertSession(id, name, cwd, toolId);
    setTmuxName(id, opts.tmuxSession);
    updateSessionStatus(id, 'running');
    if (opts?.worktreePath || opts?.repo) {
      setSessionMeta(id, opts.worktreePath, opts.repo);
    }
    queueInitialPrompt(id, toolId, opts?.initialPrompt);
    return getSession(id)!;
  }

  const tool = resolveLaunchTool(toolId);
  const tmuxName = `${tool.sessionPrefix}${id}`;

  launchToolInTmux({
    tmuxName,
    cwd,
    tool,
    bootstrapCommand: opts?.bootstrapCommand,
    prompt: opts?.initialPrompt,
    extraEnv: {
      CC_SESSION_ID: id,
      CC_SESSION_NAME: name,
      CC_TMUX_SESSION: tmuxName,
    },
  });

  insertSession(id, name, cwd, toolId);
  setTmuxName(id, tmuxName);
  updateSessionStatus(id, 'running');

  if (opts?.worktreePath || opts?.repo) {
    setSessionMeta(id, opts.worktreePath, opts.repo);
  }

  queueInitialPrompt(id, toolId, opts?.initialPrompt);
  return getSession(id)!;
}

/** List all sessions, syncing tmux state. */
export function listSessions(): Session[] {
  const sessions = getAllSessions();

  for (const session of sessions) {
    const exists = tmuxSessionExists(getSessionTmuxName(session));
    if (!exists && session.status !== 'dead') {
      updateSessionStatus(session.id, 'dead');
      session.status = 'dead';
    }
  }

  return sessions;
}

/** Get a single session by ID. */
export { getSession };

/** Kill a tmux session and remove from DB. */
export function killSession(id: string): boolean {
  const session = getSession(id);
  if (!session) return false;

  const tmuxName = getSessionTmuxName(session);
  if (tmuxSessionExists(tmuxName)) {
    try {
      execFileSync('tmux', ['send-keys', '-t', tmuxName, 'C-c', '']);
      execFileSync('tmux', ['kill-session', '-t', tmuxName]);
    } catch {
      // Session may already be gone.
    }
  }

  if (session.worktree_path) {
    try {
      const repoName = basename(dirname(session.worktree_path));
      const mainPath = join(dirname(session.worktree_path), `${repoName}-main`);
      execFileSync('git', ['-C', mainPath, 'worktree', 'remove', '--force', session.worktree_path]);
    } catch (err) {
      console.error(`Failed to remove worktree ${session.worktree_path}:`, err);
    }
  }

  removeSession(id);
  return true;
}

/** Restart a session using its stored tool definition. */
export function refreshSession(id: string): boolean {
  const session = getSession(id);
  if (!session) return false;

  const tool = resolveLaunchTool(session.tool_id);
  const tmuxName = getSessionTmuxName(session);
  const cwd = session.cwd === '~' ? process.env.HOME || '~' : session.cwd;

  try {
    if (!tmuxSessionExists(tmuxName)) {
      launchToolInTmux({
        tmuxName,
        cwd,
        tool,
        extraEnv: {
          CC_SESSION_ID: id,
          CC_SESSION_NAME: session.name,
          CC_TMUX_SESSION: tmuxName,
        },
      });
      setTmuxName(id, tmuxName);
      updateSessionStatus(id, 'running');
      return true;
    }

    execFileSync('tmux', ['set-option', '-t', tmuxName, 'remain-on-exit', 'on']);
    respawnSessionPane({
      tmuxName,
      cwd,
      tool,
      extraEnv: {
        CC_SESSION_ID: id,
        CC_SESSION_NAME: session.name,
        CC_TMUX_SESSION: tmuxName,
      },
    });
    updateSessionStatus(id, 'running');
    return true;
  } catch (err) {
    console.error('[refresh] failed to restart session:', err);
    return false;
  }
}

function recoverOrphanSessions() {
  const toolsByPrefix = listCliTools().map((tool) => ({ toolId: tool.id, prefix: tool.sessionPrefix }));

  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tmuxSessions = output.trim().split('\n').filter(Boolean);

    for (const name of tmuxSessions) {
      const match = toolsByPrefix.find((tool) => name.startsWith(tool.prefix));
      if (!match) continue;
      const id = name.slice(match.prefix.length);
      if (!id || getSession(id)) continue;
      insertSession(id, `recovered-${id}`, '~', match.toolId);
      setTmuxName(id, name);
      updateSessionStatus(id, 'running');
    }
  } catch {
    // No tmux server running.
  }
}

/** Sync DB with tmux on startup — mark dead sessions, adopt orphans. */
export function syncSessionsWithTmux() {
  const sessions = getAllSessions();

  for (const session of sessions) {
    if (!tmuxSessionExists(getSessionTmuxName(session))) {
      updateSessionStatus(session.id, 'dead');
    } else if (session.status === 'dead' || session.status === 'starting') {
      updateSessionStatus(session.id, 'running');
    }
  }

  recoverOrphanSessions();
}
