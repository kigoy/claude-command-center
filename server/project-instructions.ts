import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const SOURCE_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
const TARGET_FILES = [
  'GEMINI.md',
  'copilot-instructions.md',
  '.github/copilot-instructions.md',
] as const;

export function getProjectGuidancePath(projectPath: string): string | null {
  for (const filename of SOURCE_FILES) {
    const candidate = join(projectPath, filename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readProjectGuidance(projectPath: string): string | null {
  const guidancePath = getProjectGuidancePath(projectPath);
  if (!guidancePath) return null;
  try {
    return readFileSync(guidancePath, 'utf-8');
  } catch {
    return null;
  }
}

export function ensureProjectInstructionFiles(projectPath: string): string[] {
  const guidance = readProjectGuidance(projectPath);
  if (!guidance) return [];

  const created: string[] = [];
  for (const relativePath of TARGET_FILES) {
    const absolutePath = join(projectPath, relativePath);
    if (existsSync(absolutePath)) continue;

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, guidance);
    created.push(absolutePath);
  }

  return created;
}
