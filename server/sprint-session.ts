import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, writeFileSync } from 'fs';
import { getCliTool } from './cli-tools.js';
import { appendSprintActivity } from './sprint-history.js';
import { buildSprintCommandPrompt } from './sprint-command-help.js';
import { launchToolInTmux, shouldSendPromptOverStdin } from './session-runtime.js';
import { type SprintState, writeSprintState } from './sprint-state.js';

export function getSprintToolId(state: SprintState): string {
  return state.tool_id || 'claude';
}

function resolveSprintTool(toolId?: string) {
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

export function getSprintTmuxSessionName(projectId: string, featureId: string): string {
  return `${projectId}-${featureId.replace(/^feat-/, '')}`;
}

export function sendPromptToSprintSession(sessionName: string, prompt: string) {
  const tmpFile = join(tmpdir(), `explore-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);
  execFileSync('tmux', ['load-buffer', tmpFile]);
  execFileSync('tmux', ['paste-buffer', '-t', sessionName]);
  execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter']);
  unlinkSync(tmpFile);
}

export function launchSprintTool(opts: {
  sessionName: string;
  cwd: string;
  toolId?: string;
  prompt?: string;
  projectId?: string;
  featureId?: string;
}) {
  const tool = resolveSprintTool(opts.toolId);
  launchToolInTmux({
    tmuxName: opts.sessionName,
    cwd: opts.cwd,
    tool,
    prompt: opts.prompt,
    extraEnv: {
      CC_TMUX_SESSION: opts.sessionName,
      CC_SPRINT_PROJECT_ID: opts.projectId ?? '',
      CC_SPRINT_FEATURE_ID: opts.featureId ?? '',
    },
  });

  if (opts.prompt && shouldSendPromptOverStdin(tool, opts.prompt)) {
    setTimeout(() => {
      try {
        sendPromptToSprintSession(opts.sessionName, opts.prompt!);
      } catch {
        // Non-fatal.
      }
    }, 5000);
  }
}

export function executeSprintCommand(input: {
  projectId: string;
  projectPath: string;
  featureId: string;
  sprintDir: string;
  state: SprintState;
  command: string;
}) {
  const { projectId, projectPath, featureId, sprintDir, state, command } = input;
  const sessionName = getSprintTmuxSessionName(projectId, featureId);
  const prompt = buildSprintCommandPrompt({
    command,
    projectId,
    projectPath,
    sprintDir,
    state,
    toolId: getSprintToolId(state),
  });

  let sessionExists = true;
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
  } catch {
    sessionExists = false;
  }

  if (!sessionExists) {
    launchSprintTool({
      sessionName,
      cwd: projectPath,
      toolId: getSprintToolId(state),
      prompt,
      projectId,
      featureId: state.feature,
    });
  } else {
    sendPromptToSprintSession(sessionName, prompt);
  }

  const nextState = appendSprintActivity(state, {
    ts: new Date().toISOString(),
    kind: 'action',
    title: `Sent ${command.trim()}`,
    detail: 'Queued to the sprint terminal session.',
    phase: state.phase,
  });
  writeSprintState(sprintDir, nextState);

  return { prompt, sessionName, state: nextState };
}
