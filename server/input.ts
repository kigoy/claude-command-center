import { execFileSync } from 'child_process';
import { getSession } from './db.js';
import { getSessionTmuxName } from './session-runtime.js';

/** Send input to a tmux session via send-keys (works without a spawned pty) */
export function sendInput(sessionId: string, text: string): boolean {
  const session = getSession(sessionId);
  if (!session || session.status === 'dead') return false;

  const tmuxName = getSessionTmuxName(session);
  try {
    execFileSync('tmux', ['send-keys', '-t', tmuxName, '-l', text]);
    execFileSync('tmux', ['send-keys', '-t', tmuxName, 'Enter']);
    return true;
  } catch {
    return false;
  }
}
