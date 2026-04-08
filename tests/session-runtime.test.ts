import { describe, expect, it } from 'vitest';
import { buildPaneLaunchCommand, buildToolLaunchCommand, shouldSendPromptOverStdin } from '../server/session-runtime.js';
import type { CliTool } from '../server/cli-tools.js';

function makeTool(overrides: Partial<CliTool> = {}): CliTool {
  return {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: [],
    sessionPrefix: 'cc-',
    enabled: true,
    builtIn: true,
    sortOrder: 0,
    promptMode: 'stdin',
    promptArgTemplate: null,
    statusDetection: null,
    env: null,
    notes: null,
    ...overrides,
  };
}

describe('session-runtime', () => {
  it('launches Copilot with -i when an initial prompt exists', () => {
    const tool = makeTool({
      id: 'copilot',
      label: 'GitHub Copilot',
      command: 'gh',
      args: ['copilot', '--', '--yolo'],
      sessionPrefix: 'ghc-',
    });

    expect(buildToolLaunchCommand(tool, 'Investigate this repo')).toBe(
      "'gh' 'copilot' '--' '--yolo' '-i' 'Investigate this repo'",
    );
  });

  it('does not send Copilot prompts over stdin', () => {
    const tool = makeTool({
      id: 'copilot',
      label: 'GitHub Copilot',
      command: 'gh',
      args: ['copilot'],
      sessionPrefix: 'ghc-',
    });

    expect(shouldSendPromptOverStdin(tool, 'Investigate this repo')).toBe(false);
  });

  it('keeps stdin prompt delivery for Claude', () => {
    const tool = makeTool();

    expect(shouldSendPromptOverStdin(tool, 'Investigate this repo')).toBe(true);
  });

  it('builds a pane launch command that exits with the tool process', () => {
    const tool = makeTool();

    expect(buildPaneLaunchCommand(tool, undefined, 'cd frontend')).toBe(
      "cd frontend && exec 'claude'",
    );
  });
});
