import { rmSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { tmuxSessionExists } from './session-runtime.js';

export function deleteSprintArtifacts(projectPath: string, featureId: string, tmuxSession: string): void {
  if (tmuxSessionExists(tmuxSession)) {
    try {
      execFileSync('tmux', ['kill-session', '-t', tmuxSession], { stdio: 'ignore' });
    } catch {
      // Session may already be gone.
    }
  }

  rmSync(join(projectPath, '.sprints', featureId), { recursive: true, force: true });
}
