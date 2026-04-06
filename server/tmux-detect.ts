import { execFileSync } from 'child_process';
import { getProjects, getGroups } from './sprint-config.js';

// --- Types ---

export interface TmuxSprintSession {
  sessionName: string;
  projectId: string;
  feature: string;
  claudeActive: boolean;
}

// --- State ---

let detectedSessions: TmuxSprintSession[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;

// --- Helpers ---

/** Get all active tmux session names. */
function listTmuxSessions(): string[] {
  try {
    const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Check if Claude is active in a tmux session by inspecting recent pane output. */
function isClaudeActive(sessionName: string): boolean {
  try {
    const output = execFileSync('tmux', ['capture-pane', '-t', sessionName, '-p'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const tail = output.split('\n').slice(-5).join('\n').toLowerCase();
    // Spinner chars, claude prompt, or "claude" text indicate activity
    const patterns = [/claude/, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, /\$\s*claude/, /thinking/];
    return patterns.some((p) => p.test(tail));
  } catch {
    return false;
  }
}

/** Build lookup of project IDs from all known naming patterns. */
function buildSessionMatchers(): Array<{
  pattern: RegExp;
  projectId: string;
}> {
  const matchers: Array<{ pattern: RegExp; projectId: string }> = [];
  const projects = getProjects();
  const groups = getGroups();

  for (const project of projects) {
    // Pattern: {projectId}-{feature} (existing)
    matchers.push({
      pattern: new RegExp(`^${escapeRegex(project.id)}-(.+)$`),
      projectId: project.id,
    });

    // Pattern: {group}-{projectId}-{feature} (new group-based)
    for (const group of groups) {
      if (group.projects.includes(project.id)) {
        matchers.push({
          pattern: new RegExp(`^${escapeRegex(group.id)}-${escapeRegex(project.id)}-(.+)$`),
          projectId: project.id,
        });
      }
    }
  }

  return matchers;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a tmux session name to a project/feature pair. */
function matchSession(
  sessionName: string,
  matchers: Array<{ pattern: RegExp; projectId: string }>,
): { projectId: string; feature: string } | null {
  for (const matcher of matchers) {
    const match = sessionName.match(matcher.pattern);
    if (match) {
      return { projectId: matcher.projectId, feature: match[1] };
    }
  }
  return null;
}

/** Run one detection cycle: list tmux sessions, match to sprints, check claude. */
function detectSessions(): void {
  const sessionNames = listTmuxSessions();
  const matchers = buildSessionMatchers();

  const results: TmuxSprintSession[] = [];
  for (const name of sessionNames) {
    const matched = matchSession(name, matchers);
    if (!matched) continue;

    results.push({
      sessionName: name,
      projectId: matched.projectId,
      feature: matched.feature,
      claudeActive: isClaudeActive(name),
    });
  }

  detectedSessions = results;
}

// --- Public API ---

/** Get the most recently detected tmux sprint sessions. */
export function getSprintSessions(): readonly TmuxSprintSession[] {
  return detectedSessions;
}

/** Start polling for tmux sprint sessions every 10 seconds. */
export function startTmuxDetection(): void {
  if (pollInterval) return;

  // Run immediately on start
  detectSessions();
  console.log(`[tmux-detect] Initial scan: ${detectedSessions.length} sprint sessions`);

  pollInterval = setInterval(() => {
    try {
      detectSessions();
    } catch (err) {
      console.warn(`[tmux-detect] Poll error: ${err}`);
    }
  }, 10_000);
}
