import { readFileSync } from 'fs';
import { join } from 'path';
import type { SprintState } from './sprint-state.js';

/** Parse ATOMS.md to extract total/completed counts from per-atom status lines.
 *  Returns null when ATOMS.md does not exist (distinct from 0/0). */
export function parseAtomCounts(sprintDir: string): { total: number; completed: number } | null {
  const atomsPath = join(sprintDir, 'ATOMS.md');
  try {
    const raw = readFileSync(atomsPath, 'utf-8');
    const statusLines = raw.match(/^- Status:\s*.+$/gm) || [];
    const total = statusLines.length;
    const statusCompleted = statusLines.filter(
      (line) => /\bDONE\b/i.test(line) || /\bCOMPLETE\b/i.test(line) || line.includes('\u2705'),
    ).length;
    // Also count heading-level checkmarks (e.g., "### Atom 1: title ✅")
    const headingCompleted = (raw.match(/^###\s+Atom\s+\d+:.+\u2705/gm) || []).length;
    return { total, completed: Math.max(statusCompleted, headingCompleted) };
  } catch {
    return null;
  }
}

/** Extract atom counts from STATE.json phase_history BUILD entry (fallback). */
export function atomCountsFromState(state: SprintState): { total: number; completed: number } | null {
  const history = state.phase_history as Array<Record<string, unknown>>;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.phase === 'BUILD' && typeof entry.atoms_total === 'number') {
      return {
        total: entry.atoms_total as number,
        completed: (entry.atoms_completed as number) ?? 0,
      };
    }
  }
  return null;
}

/** Resolve atom counts: ATOMS.md first, then STATE.json fallback. */
export function resolveAtomCounts(
  sprintDir: string,
  state: SprintState,
): { total: number; completed: number; has_atoms: boolean } {
  const fromFile = parseAtomCounts(sprintDir);
  if (!fromFile) {
    const fromState = atomCountsFromState(state);
    return fromState
      ? { ...fromState, has_atoms: false }
      : { total: 0, completed: 0, has_atoms: false };
  }

  // ATOMS.md exists but shows 0 completed — fall back to STATE.json if available
  if (fromFile.completed === 0 && fromFile.total > 0) {
    const fromState = atomCountsFromState(state);
    if (fromState && fromState.completed > 0) {
      return { total: fromFile.total, completed: fromState.completed, has_atoms: true };
    }
  }

  return { ...fromFile, has_atoms: true };
}
