import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SprintState } from './sprint-state.js';
import { getProjectGuidancePath } from './project-instructions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GSTACK_ROOT = process.env.GSTACK_ROOT || '/Volumes/Extreme Pro/.gstack';
export const SPRINT_COMMAND_HELP_PATH = join(__dirname, '..', 'SPRINT_COMMAND_HELP.md');

function maybeLine(path: string, label: string): string {
  return existsSync(path) ? `${label}: ${path}` : '';
}

function projectGuidanceLine(projectPath: string): string {
  const guidancePath = getProjectGuidancePath(projectPath);
  return guidancePath ? `Project guidance: ${guidancePath}` : '';
}

function shouldLeadWithCommand(toolId?: string): boolean {
  return toolId === 'copilot';
}

export function buildSprintBootstrapPrompt(opts: {
  projectId: string;
  projectPath: string;
  sprintDir: string;
  state: SprintState;
  extraContext?: string;
}) {
  const { projectId, projectPath, sprintDir, state, extraContext } = opts;
  const lines = [
    `Read ${SPRINT_COMMAND_HELP_PATH} first.`,
    `Use ${GSTACK_ROOT}/orchestrator.md as the workflow source of truth.`,
    projectGuidanceLine(projectPath),
    maybeLine(join(sprintDir, 'STATE.json'), 'Sprint state'),
    maybeLine(join(sprintDir, 'ATOMS.md'), 'Sprint atoms'),
    `This sprint is ${projectId}/${state.feature} and is currently in ${state.phase}.`,
    'If this CLI does not support Sprint Command slash commands, treat them as workflow names and read the matching skill file under the gstack skills directory manually.',
    'Start by summarizing the current sprint state and the next action you intend to take.',
    extraContext?.trim() || '',
  ].filter(Boolean);

  return lines.join('\n');
}

export function buildSprintCommandPrompt(opts: {
  command: string;
  projectId: string;
  projectPath: string;
  sprintDir: string;
  state: SprintState;
  toolId?: string;
}) {
  const { command, projectId, projectPath, sprintDir, state, toolId } = opts;
  const trimmed = command.trim();
  const skillName = trimmed.replace(/^\//, '').split(/\s+/)[0];
  const skillPath = join(GSTACK_ROOT, 'skills', skillName, 'SKILL.md');
  const lines = [
    shouldLeadWithCommand(toolId) ? trimmed : '',
    `Read ${SPRINT_COMMAND_HELP_PATH}.`,
    `Use ${GSTACK_ROOT}/orchestrator.md as the workflow source of truth.`,
    projectGuidanceLine(projectPath),
    maybeLine(join(sprintDir, 'STATE.json'), 'Sprint state'),
    maybeLine(join(sprintDir, 'ATOMS.md'), 'Sprint atoms'),
    existsSync(skillPath) ? `Read ${skillPath}.` : '',
    `Execute the Sprint Command workflow request \`${trimmed}\` for ${projectId}/${state.feature} from phase ${state.phase}.`,
    shouldLeadWithCommand(toolId)
      ? 'Immediately execute the slash command on the first line. If slash commands are not supported in this CLI, follow the corresponding workflow manually after reading the referenced skill.'
      : 'If slash commands are not supported in this CLI, follow the corresponding workflow manually after reading the referenced skill.',
    'When you are done, summarize the outcome and the next recommended action in the terminal.',
  ].filter(Boolean);

  return lines.join('\n');
}

export function buildExploreIdeaPrompt(opts: {
  projectId: string;
  projectPath: string;
  sprintDir: string;
  state: SprintState;
  description?: string;
  toolId?: string;
}) {
  const { description, ...rest } = opts;
  const lines = [
    buildSprintCommandPrompt({
      ...rest,
      command: '/office-hours',
    }),
    'This sprint was created from the Explore Idea flow.',
    description?.trim() ? `Idea brief:\n${description.trim()}` : 'No idea brief was provided.',
    'Do not stop after summarizing the sprint state. Start the office-hours workflow immediately and ask the first question.',
  ];

  return lines.join('\n\n');
}
