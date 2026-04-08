import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { appendSprintActivity } from './sprint-history.js';
import { isRecommendedAutomationEnabled } from './sprint-automation.js';
import { getProjects } from './sprint-config.js';
import { readSprintState, writeSprintState } from './sprint-state.js';
import { getSprintSessions } from './tmux-detect.js';

const POLL_INTERVAL_MS = 5_000;
const PROMPT_LINES = 120;

type PromptMatch = {
  signature: string;
  question: string;
  selection: string;
};

const handledPromptSignatures = new Map<string, string>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function normalizeText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[│┃]/g, '|')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function capturePane(sessionName: string): string {
  try {
    return execFileSync('tmux', ['capture-pane', '-t', sessionName, '-p', '-S', `-${PROMPT_LINES}`], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function extractPromptBlock(output: string): string | null {
  const lines = output.split('\n');
  const footer = lines.findIndex((line) => /Enter to (confirm|select)/i.test(line));
  if (footer === -1) return null;

  const askingStart = lines.findIndex((line) => /Asking user/i.test(line));
  if (askingStart !== -1 && askingStart <= footer) {
    return lines.slice(askingStart, footer + 1).join('\n');
  }

  const selected = lines.findIndex((line, index) => index <= footer && /^\s*[❯>]\s*1\./.test(line));
  if (selected === -1) return null;

  const start = Math.max(0, selected - 8);
  return lines.slice(start, footer + 1).join('\n');
}

function extractQuestion(block: string): string {
  const lines = block
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);

  for (const line of lines) {
    if (/^Asking user\s+/i.test(line)) {
      return line.replace(/^Asking user\s+/i, '').trim();
    }
    if (/^[☐◯○]\s+/.test(line)) continue;
    if (/^[❯>]\s*\d+\./.test(line)) continue;
    if (/^\d+\./.test(line)) continue;
    if (/^[-|]+$/.test(line)) continue;
    if (/Enter to (confirm|select)/i.test(line)) continue;
    return line;
  }

  return 'Terminal workflow prompt';
}

function matchPrompt(output: string): PromptMatch | null {
  const block = extractPromptBlock(output);
  if (!block) return null;

  if (!/❯\s*1\.|>\s*1\./.test(block)) return null;
  if (/User selected:/i.test(block)) return null;

  const normalized = normalizeText(block);
  const selectionMatch = block.match(/^\s*[❯>]\s*1\.\s*(.+)$/m);

  return {
    signature: normalized,
    question: extractQuestion(block),
    selection: normalizeText(selectionMatch?.[1] || 'Option 1'),
  };
}

function sendRecommendedAnswer(sessionName: string): boolean {
  try {
    execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter'], {
      timeout: 3000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function resolveSprintDir(projectPath: string, feature: string): string | null {
  const sprintsDir = join(projectPath, '.sprints');
  const directCandidates = [feature, `feat-${feature}`];

  for (const candidate of directCandidates) {
    const sprintDir = join(sprintsDir, candidate);
    if (existsSync(join(sprintDir, 'STATE.json'))) return sprintDir;
  }

  try {
    for (const entry of readdirSync(sprintsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sprintDir = join(sprintsDir, entry.name);
      const state = readSprintState(sprintDir);
      if (!state) continue;
      if (state.feature.replace(/^feat-/, '') === feature) return sprintDir;
    }
  } catch {
    return null;
  }

  return null;
}

function recordAutoAnswer(sprintDir: string, phase: string, question: string, selection: string): void {
  const currentState = readSprintState(sprintDir);
  if (!currentState) return;

  writeSprintState(sprintDir, appendSprintActivity(currentState, {
    ts: new Date().toISOString(),
    kind: 'action',
    title: 'Accepted recommended terminal answer',
    detail: `${question} -> ${selection}`,
    phase,
  }));
}

function pollSprintTerminalPrompts(): void {
  const projectsById = new Map(getProjects().map((project) => [project.id, project]));

  for (const session of getSprintSessions()) {
    const project = projectsById.get(session.projectId);
    if (!project) continue;

    const sprintDir = resolveSprintDir(project.path, session.feature);
    if (!sprintDir) continue;

    const state = readSprintState(sprintDir);
    if (!state || !isRecommendedAutomationEnabled(state)) continue;

    const prompt = matchPrompt(capturePane(session.sessionName));
    if (!prompt) continue;

    if (handledPromptSignatures.get(session.sessionName) === prompt.signature) {
      continue;
    }

    if (!sendRecommendedAnswer(session.sessionName)) {
      continue;
    }

    handledPromptSignatures.set(session.sessionName, prompt.signature);
    recordAutoAnswer(sprintDir, state.phase, prompt.question, prompt.selection);
    console.log(`[sprint-terminal-auto] Accepted recommended prompt for ${session.sessionName}`);
  }
}

export function startSprintTerminalAutoAnswering(): void {
  if (intervalId) return;

  setTimeout(() => {
    try {
      pollSprintTerminalPrompts();
    } catch (err) {
      console.warn(`[sprint-terminal-auto] Initial poll failed: ${err}`);
    }
  }, 1_500);

  intervalId = setInterval(() => {
    try {
      pollSprintTerminalPrompts();
    } catch (err) {
      console.warn(`[sprint-terminal-auto] Poll failed: ${err}`);
    }
  }, POLL_INTERVAL_MS);

  intervalId.unref?.();
}
