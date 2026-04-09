import { execFileSync } from 'child_process';
import { getProjects, getGroups } from './sprint-config.js';

// --- Types ---

export interface TmuxSprintSession {
  sessionName: string;
  projectId: string;
  feature: string;
  agentActive: boolean;
  activityAt: string | null;
}

// --- State ---

let detectedSessions: TmuxSprintSession[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;

// --- Helpers ---

/** Get all active tmux session names with their last activity time. */
function listTmuxSessions(): Array<{ sessionName: string; activityAt: string | null }> {
  try {
    const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}\t#{session_activity}'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sessionName, rawActivity] = line.split('\t');
        const epochSeconds = Number.parseInt(rawActivity || '', 10);
        return {
          sessionName,
          activityAt: Number.isFinite(epochSeconds) && epochSeconds > 0
            ? new Date(epochSeconds * 1000).toISOString()
            : null,
        };
      });
  } catch {
    return [];
  }
}

/** Check if the active CLI appears to be working rather than sitting at a shell prompt. */
function isAgentActive(sessionName: string): boolean {
  try {
    const output = execFileSync('tmux', ['capture-pane', '-t', sessionName, '-p'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tailLines = output.split('\n').slice(-8);
    const tail = tailLines.join('\n');
    const lastLine = tailLines[tailLines.length - 1]?.trim() || '';

    if (!tail.trim()) return false;
    if (/[$%#❯>]\s*$/.test(lastLine)) return false;
    if (/do you want to proceed\?|allow|approve|deny|yes.*no/i.test(tail)) return true;
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●∙]/.test(tail)) return true;
    if (/thinking|processing|reading|writing|loading|pending|running/i.test(tail)) return true;

    return false;
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

/** Run one detection cycle: list tmux sessions, match to sprints, check recent activity. */
function detectSessions(): void {
  const sessions = listTmuxSessions();
  const matchers = buildSessionMatchers();

  const results: TmuxSprintSession[] = [];
  for (const { sessionName, activityAt } of sessions) {
    const matched = matchSession(sessionName, matchers);
    if (!matched) continue;

    results.push({
      sessionName,
      projectId: matched.projectId,
      feature: matched.feature,
      agentActive: isAgentActive(sessionName),
      activityAt,
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
