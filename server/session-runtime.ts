import { execFileSync } from 'child_process';
import type { Session } from './db.js';
import { getCliTool, type CliTool } from './cli-tools.js';

const LEGACY_TMUX_PREFIX = 'cc-';

export function getSessionTool(session: Pick<Session, 'tool_id'>): CliTool | null {
  return getCliTool(session.tool_id);
}

export function getSessionTmuxName(session: Pick<Session, 'id' | 'tmux_name' | 'tool_id'>): string {
  if (session.tmux_name) return session.tmux_name;
  const tool = getSessionTool(session);
  const prefix = tool?.sessionPrefix || LEGACY_TMUX_PREFIX;
  return `${prefix}${session.id}`;
}

export function tmuxSessionExists(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function applyPromptTemplate(template: string, prompt: string): string {
  return template.replace(/\{\{\s*prompt\s*\}\}/g, prompt);
}

export function buildToolLaunchCommand(tool: CliTool, prompt?: string): string {
  if (prompt && tool.id === 'copilot') {
    return [tool.command, ...tool.args, '-i', prompt].map(shellEscape).join(' ');
  }

  const args = [...tool.args];
  if (prompt && tool.promptMode === 'arg' && tool.promptArgTemplate) {
    args.push(applyPromptTemplate(tool.promptArgTemplate, prompt));
  }
  return [tool.command, ...args].map(shellEscape).join(' ');
}

export function buildPaneLaunchCommand(tool: CliTool, prompt?: string, bootstrapCommand?: string): string {
  const toolCommand = buildToolLaunchCommand(tool, prompt);
  if (bootstrapCommand?.trim()) {
    return `${bootstrapCommand.trim()} && exec ${toolCommand}`;
  }
  return `exec ${toolCommand}`;
}

export function shouldSendPromptOverStdin(tool: CliTool, prompt?: string): boolean {
  if (prompt && tool.id === 'copilot') {
    return false;
  }
  return !!prompt && tool.promptMode === 'stdin';
}

export function buildToolEnv(tool: CliTool): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  if (tool.env) {
    for (const [key, value] of Object.entries(tool.env)) {
      env[key] = value;
    }
  }

  return env;
}

export function launchToolInTmux(opts: {
  tmuxName: string;
  cwd: string;
  tool: CliTool;
  bootstrapCommand?: string;
  prompt?: string;
}) {
  const { tmuxName, cwd, tool, bootstrapCommand, prompt } = opts;
  const shell = process.env.SHELL || '/bin/bash';
  const launchCommand = buildPaneLaunchCommand(tool, prompt, bootstrapCommand);
  execFileSync('tmux', ['new-session', '-d', '-s', tmuxName, '-c', cwd, shell, '-lc', launchCommand], {
    env: buildToolEnv(tool),
  });
}

export function respawnSessionPane(opts: {
  tmuxName: string;
  cwd: string;
  tool: CliTool;
  prompt?: string;
  bootstrapCommand?: string;
}) {
  const { tmuxName, cwd, tool, prompt, bootstrapCommand } = opts;
  const shell = process.env.SHELL || '/bin/bash';
  const launchCommand = buildPaneLaunchCommand(tool, prompt, bootstrapCommand);
  execFileSync('tmux', ['respawn-pane', '-k', '-t', tmuxName, '-c', cwd, shell], {
    env: buildToolEnv(tool),
  });
  execFileSync('tmux', ['set-option', '-t', tmuxName, 'remain-on-exit', 'off']);
  execFileSync('tmux', ['send-keys', '-t', tmuxName, '-l', `${shell} -lc ${shellEscape(launchCommand)}`]);
  execFileSync('tmux', ['send-keys', '-t', tmuxName, 'Enter']);
}

export function getToolDisplayLabel(toolId: string, tool?: CliTool | null): string {
  if (tool?.label) return tool.label;
  return toolId;
}
