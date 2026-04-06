import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getProjects } from './sprint-config.js';
import { readSprintState } from './sprint-state.js';

// --- Types ---

interface PhaseEntry {
  phase?: string;
  entered?: string;
  exited?: string;
}

interface SprintMetrics {
  feature: string;
  phase: string;
  is_complete: boolean;
  atoms_total: number;
  atoms_completed: number;
  chain_compliant: boolean;
  elapsed_hours: number | null;
}

interface ProjectRetro {
  id: string;
  sprints_completed: number;
  sprints_active: number;
  atoms_shipped: number;
  atoms_planned: number;
  chain_compliance_pct: number;
  sprints: SprintMetrics[];
}

export interface RetroSummary {
  generated_at: string;
  retro_due: boolean;
  days_since_last_retro: number | null;
  aggregate: {
    sprints_completed: number;
    sprints_active: number;
    atoms_shipped: number;
    atoms_planned: number;
    chain_compliance_pct: number;
    avg_hours_to_complete: number | null;
  };
  projects: ProjectRetro[];
}

// --- Helpers ---

const GSTACK_ROOT = process.env.GSTACK_ROOT || '/Volumes/Extreme Pro/.gstack';
const LAST_RETRO_PATH = join(GSTACK_ROOT, 'sync', 'last-retro.json');
const RETRO_CADENCE_DAYS = 7;

/** Parse atom counts from ATOMS.md status lines */
function parseAtomCounts(sprintDir: string): { total: number; completed: number } {
  const atomsPath = join(sprintDir, 'ATOMS.md');
  try {
    const raw = readFileSync(atomsPath, 'utf-8');
    const statusLines = raw.match(/^- Status:\s*.+$/gm) || [];
    const total = statusLines.length;
    const completed = statusLines.filter(
      (line) => /\bDONE\b/i.test(line) || /\bCOMPLETE\b/i.test(line) || line.includes('\u2705'),
    ).length;
    return { total, completed };
  } catch {
    return { total: 0, completed: 0 };
  }
}

/** Check if BUILD->REVIEW transition exists in phase_history */
function isChainCompliant(phaseHistory: unknown[]): boolean {
  const entries = phaseHistory as PhaseEntry[];
  const phases = entries.map((e) => e.phase).filter(Boolean);

  // Chain compliant = BUILD followed by REVIEW at some point
  const buildIdx = phases.indexOf('BUILD');
  const reviewIdx = phases.indexOf('REVIEW');

  // If sprint never reached BUILD, chain compliance is N/A (count as compliant)
  if (buildIdx === -1) return true;
  // If sprint reached BUILD but not REVIEW, it's either still in BUILD (ok) or skipped (not ok)
  if (reviewIdx === -1) {
    // Still in BUILD = hasn't had the chance yet, count as compliant
    return true;
  }
  // REVIEW must come after BUILD
  return reviewIdx > buildIdx;
}

/** Hours between created timestamp and COMPLETE entry, or null */
function hoursToComplete(created: string, phaseHistory: unknown[]): number | null {
  const entries = phaseHistory as PhaseEntry[];
  const completeEntry = entries.find((e) => e.phase === 'COMPLETE');
  if (!completeEntry?.entered) return null;

  const start = new Date(created).getTime();
  const end = new Date(completeEntry.entered).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

/** Days since last retro, or null if never run */
function daysSinceLastRetro(): number | null {
  try {
    const raw = readFileSync(LAST_RETRO_PATH, 'utf-8');
    const data = JSON.parse(raw) as { timestamp: string };
    const then = new Date(data.timestamp).getTime();
    if (isNaN(then)) return null;
    return (Date.now() - then) / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}

/** Chain compliance percentage: compliant / (total that reached REVIEW or beyond) */
function compliancePct(sprints: SprintMetrics[]): number {
  const relevant = sprints.filter((s) => s.atoms_total > 0 || s.is_complete);
  if (relevant.length === 0) return 100;
  const compliant = relevant.filter((s) => s.chain_compliant).length;
  return Math.round((compliant / relevant.length) * 100);
}

// --- Public API ---

/** Build cross-project retro summary */
export function buildRetroSummary(): RetroSummary {
  const projects = getProjects();
  const projectRetros: ProjectRetro[] = [];

  let totalCompleted = 0;
  let totalActive = 0;
  let totalAtomsShipped = 0;
  let totalAtomsPlanned = 0;
  const completionTimes: number[] = [];
  const allSprintMetrics: SprintMetrics[] = [];

  for (const project of projects) {
    const sprintsDir = join(project.path, '.sprints');
    if (!existsSync(sprintsDir)) {
      projectRetros.push({
        id: project.id,
        sprints_completed: 0,
        sprints_active: 0,
        atoms_shipped: 0,
        atoms_planned: 0,
        chain_compliance_pct: 100,
        sprints: [],
      });
      continue;
    }

    const sprintMetrics: SprintMetrics[] = [];

    try {
      const entries = readdirSync(sprintsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        const featureDir = join(sprintsDir, entry.name);
        const state = readSprintState(featureDir);
        if (!state) continue;

        const atoms = parseAtomCounts(featureDir);
        const isComplete = state.phase === 'COMPLETE';
        const elapsed = hoursToComplete(state.created, state.phase_history);
        const compliant = isChainCompliant(state.phase_history);

        const metrics: SprintMetrics = {
          feature: state.feature,
          phase: state.phase,
          is_complete: isComplete,
          atoms_total: atoms.total,
          atoms_completed: atoms.completed,
          chain_compliant: compliant,
          elapsed_hours: elapsed,
        };

        sprintMetrics.push(metrics);
        allSprintMetrics.push(metrics);

        if (isComplete) {
          totalCompleted++;
          if (elapsed !== null) completionTimes.push(elapsed);
        } else {
          totalActive++;
        }
        totalAtomsShipped += atoms.completed;
        totalAtomsPlanned += atoms.total;
      }
    } catch {
      // Can't read directory
    }

    projectRetros.push({
      id: project.id,
      sprints_completed: sprintMetrics.filter((s) => s.is_complete).length,
      sprints_active: sprintMetrics.filter((s) => !s.is_complete).length,
      atoms_shipped: sprintMetrics.reduce((n, s) => n + s.atoms_completed, 0),
      atoms_planned: sprintMetrics.reduce((n, s) => n + s.atoms_total, 0),
      chain_compliance_pct: compliancePct(sprintMetrics),
      sprints: sprintMetrics,
    });
  }

  const daysSince = daysSinceLastRetro();
  const avgCompletion = completionTimes.length > 0
    ? Math.round((completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length) * 10) / 10
    : null;

  return {
    generated_at: new Date().toISOString(),
    retro_due: daysSince === null || daysSince >= RETRO_CADENCE_DAYS,
    days_since_last_retro: daysSince !== null ? Math.round(daysSince * 10) / 10 : null,
    aggregate: {
      sprints_completed: totalCompleted,
      sprints_active: totalActive,
      atoms_shipped: totalAtomsShipped,
      atoms_planned: totalAtomsPlanned,
      chain_compliance_pct: compliancePct(allSprintMetrics),
      avg_hours_to_complete: avgCompletion,
    },
    projects: projectRetros,
  };
}

/** Mark retro as run (updates last-retro.json) */
export function markRetroRun(): void {
  const data = { timestamp: new Date().toISOString() };
  try {
    writeFileSync(LAST_RETRO_PATH, JSON.stringify(data, null, 2) + '\n');
  } catch {
    // sync/ dir may not exist — non-fatal
  }
}
