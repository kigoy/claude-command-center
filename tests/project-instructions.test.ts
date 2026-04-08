import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureProjectInstructionFiles, getProjectGuidancePath } from '../server/project-instructions.js';

describe('project-instructions', () => {
  it('creates Copilot and Gemini instruction files from CLAUDE.md', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'project-instructions-'));
    const source = '# CLAUDE.md\n\nUse the orchestrator.\n';
    writeFileSync(join(projectPath, 'CLAUDE.md'), source);

    try {
      const created = ensureProjectInstructionFiles(projectPath);

      expect(created).toHaveLength(3);
      expect(readFileSync(join(projectPath, 'GEMINI.md'), 'utf-8')).toBe(source);
      expect(readFileSync(join(projectPath, 'copilot-instructions.md'), 'utf-8')).toBe(source);
      expect(readFileSync(join(projectPath, '.github', 'copilot-instructions.md'), 'utf-8')).toBe(source);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('does not overwrite existing target instruction files', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'project-instructions-'));
    writeFileSync(join(projectPath, 'CLAUDE.md'), 'source\n');
    writeFileSync(join(projectPath, 'GEMINI.md'), 'custom\n');

    try {
      const created = ensureProjectInstructionFiles(projectPath);

      expect(created).toHaveLength(2);
      expect(readFileSync(join(projectPath, 'GEMINI.md'), 'utf-8')).toBe('custom\n');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('falls back to AGENTS.md when CLAUDE.md is missing', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'project-instructions-'));
    writeFileSync(join(projectPath, 'AGENTS.md'), 'agents guidance\n');

    try {
      expect(getProjectGuidancePath(projectPath)).toBe(join(projectPath, 'AGENTS.md'));
      ensureProjectInstructionFiles(projectPath);
      expect(existsSync(join(projectPath, 'copilot-instructions.md'))).toBe(true);
      expect(readFileSync(join(projectPath, 'GEMINI.md'), 'utf-8')).toBe('agents guidance\n');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
