import { execFileSync } from 'child_process';
import { getAllSessions, updateSessionStatus, updatePaneTitle } from './db.js';
import { getSessionTmuxName, getSessionTool } from './session-runtime.js';
import type { StatusDetection } from './cli-tools.js';

const POLL_INTERVAL = 3000;
const SHELL_COMMANDS = new Set(['bash', 'zsh', 'sh', 'fish']);

/** Capture the last N lines from a tmux pane */
function capturePaneLines(tmuxName: string, lines = 15): string[] {
  try {
    const output = execFileSync('tmux', ['capture-pane', '-t', tmuxName, '-p'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trimEnd().split('\n').slice(-lines);
  } catch {
    return [];
  }
}

/** Get the tmux pane title when the CLI updates it. */
function getPaneTitle(tmuxName: string): string | null {
  try {
    const output = execFileSync('tmux', [
      'display-message', '-t', tmuxName, '-p', '#{pane_title}',
    ], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const title = output.trim();
    // Ignore default/empty titles
    if (!title || title === 'bash' || title === 'zsh') return null;
    // Strip leading spinner/status characters
    return title.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✳⠐●∙\s]+/, '').trim() || null;
  } catch {
    return null;
  }
}

function getPaneCurrentCommand(tmuxName: string): string | null {
  try {
    const output = execFileSync('tmux', [
      'display-message', '-t', tmuxName, '-p', '#{pane_current_command}',
    ], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

function matchesAnyPattern(text: string, patterns?: string[]): boolean {
  if (!patterns?.length) return false;
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(text);
    } catch {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

function detectGenericStatus(lines: string[]): string {
  if (lines.length === 0) return 'dead';

  const lastLines = lines.join('\n');
  const lastLine = lines[lines.length - 1]?.trim() || '';

  if (/Do you want to proceed\?/i.test(lastLines)) return 'waiting';
  if (/allow|approve|deny|yes.*no/i.test(lastLines)) return 'waiting';
  if (/[$%#❯>]\s*$/.test(lastLine)) return 'idle';
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●∙]/.test(lastLines)) return 'running';
  if (/thinking|processing|reading|writing|loading/i.test(lastLines)) return 'running';

  return 'running';
}

/** Detect a session state from pane content using tool-specific patterns when present. */
function detectStatus(lines: string[], detection: StatusDetection | null): string {
  if (lines.length === 0) return 'dead';

  const lastLines = lines.join('\n');
  if (detection) {
    if (matchesAnyPattern(lastLines, detection.deadPatterns)) return 'dead';
    if (matchesAnyPattern(lastLines, detection.waitingPatterns)) return 'waiting';
    if (matchesAnyPattern(lastLines, detection.runningPatterns)) return 'running';
  }

  return detectGenericStatus(lines);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start polling tmux sessions for status updates */
export function startStatusPolling() {
  if (intervalId) return;

  intervalId = setInterval(() => {
    const sessions = getAllSessions();
    for (const session of sessions) {
      if (session.status === 'dead') continue;

      const tmuxName = getSessionTmuxName(session);
      const currentCommand = getPaneCurrentCommand(tmuxName);
      if (currentCommand && SHELL_COMMANDS.has(currentCommand)) {
        updateSessionStatus(session.id, 'dead');
        updatePaneTitle(session.id, null);
        try {
          execFileSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'ignore' });
        } catch {
          // Session may already be gone.
        }
        continue;
      }

      const lines = capturePaneLines(tmuxName);
      const tool = getSessionTool(session);
      const status = detectStatus(lines, tool?.statusDetection ?? null);

      if (status !== session.status) {
        updateSessionStatus(session.id, status);
      }

      const title = getPaneTitle(tmuxName);
      if (title !== session.pane_title) {
        updatePaneTitle(session.id, title);
      }
    }
  }, POLL_INTERVAL);
}

export function stopStatusPolling() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
