import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildExploreIdeaPrompt, buildSprintCommandPrompt } from '../server/sprint-command-help.js';

describe('sprint-command-help', () => {
  it('builds an explicit office-hours prompt for Explore Idea', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'sprint-command-help-'));
    const sprintDir = join(projectPath, '.sprints', 'feat-test');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(join(projectPath, 'CLAUDE.md'), '# test\n');
    writeFileSync(join(sprintDir, 'STATE.json'), '{}\n');

    try {
      const prompt = buildExploreIdeaPrompt({
        projectId: 'alpha',
        projectPath,
        sprintDir,
        state: {
          feature: 'feat-test',
          branch: 'main',
          created: '2026-04-08T00:00:00.000Z',
          phase: 'PLAN',
          phase_history: [],
          qa_routing: {},
          blocked: false,
          blocked_reason: null,
        },
        description: 'Add sentry monitor health per repo.',
      });

      expect(prompt).toContain('`/office-hours`');
      expect(prompt).toContain('Idea brief:\nAdd sentry monitor health per repo.');
      expect(prompt).toContain('Start the office-hours workflow immediately');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('puts the slash command first for Copilot workflow prompts', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'sprint-command-help-'));
    const sprintDir = join(projectPath, '.sprints', 'feat-test');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(join(projectPath, 'CLAUDE.md'), '# test\n');
    writeFileSync(join(sprintDir, 'STATE.json'), '{}\n');

    try {
      const prompt = buildSprintCommandPrompt({
        command: '/office-hours',
        projectId: 'alpha',
        projectPath,
        sprintDir,
        toolId: 'copilot',
        state: {
          feature: 'feat-test',
          branch: 'main',
          created: '2026-04-08T00:00:00.000Z',
          phase: 'PLAN',
          phase_history: [],
          qa_routing: {},
          blocked: false,
          blocked_reason: null,
        },
      });

      expect(prompt.split('\n')[0]).toBe('/office-hours');
      expect(prompt).toContain('Immediately execute the slash command on the first line.');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
