import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getProjects } from './sprint-config.js';
import { readSprintState } from './sprint-state.js';

// --- Types ---

interface PhaseEntry {
  phase?: string;
  entered?: string;
  exited?: string;
}

interface PhaseTimings {
  PLAN: number[];
  BUILD: number[];
  REVIEW: number[];
  QA: number[];
  SHIP: number[];
  [key: string]: number[];
}

interface ProjectAnalytics {
  id: string;
  sprint_count: number;
  atoms_per_sprint: number | null;
  chain_compliance_pct: number;
  avg_time_in_phase: Record<string, number | null>;
}

export interface AnalyticsSummary {
  generated_at: string;
  aggregate: {
    total_sprints: number;
    completed_sprints: number;
    active_sprints: number;
    atoms_per_sprint: number | null;
    chain_compliance_pct: number;
    avg_time_in_phase: Record<string, number | null>;
  };
  projects: ProjectAnalytics[];
}

// --- Helpers ---

/** Parse hours between entered and exited timestamps */
function phaseHours(entry: PhaseEntry): number | null {
  if (!entry.entered || !entry.exited) return null;
  const start = new Date(entry.entered).getTime();
  const end = new Date(entry.exited).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

/** Average an array of numbers, or null if empty */
function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/** Check BUILD->REVIEW chain compliance from phase_history */
function hasChainCompliance(phaseHistory: unknown[], isComplete: boolean): boolean {
  const entries = phaseHistory as PhaseEntry[];
  const phases = entries.map((e) => e.phase).filter(Boolean);
  const buildIdx = phases.indexOf('BUILD');
  const reviewIdx = phases.indexOf('REVIEW');
  if (buildIdx === -1) return true; // never reached BUILD
  if (reviewIdx === -1) return !isComplete; // COMPLETE without REVIEW = non-compliant
  return reviewIdx > buildIdx;
}

/** Parse atom counts from ATOMS.md status lines */
function countAtoms(sprintDir: string): number {
  const atomsPath = join(sprintDir, 'ATOMS.md');
  try {
    const raw = readFileSync(atomsPath, 'utf-8');
    const statusLines = raw.match(/^- Status:\s*.+$/gm) || [];
    return statusLines.length;
  } catch {
    return 0;
  }
}

// --- Core ---

function collectTimings(phaseHistory: unknown[]): PhaseTimings {
  const timings: PhaseTimings = { PLAN: [], BUILD: [], REVIEW: [], QA: [], SHIP: [] };
  const entries = phaseHistory as PhaseEntry[];

  for (const entry of entries) {
    const hours = phaseHours(entry);
    if (hours === null || !entry.phase) continue;
    if (!timings[entry.phase]) timings[entry.phase] = [];
    timings[entry.phase].push(hours);
  }

  return timings;
}

function mergeTimings(a: PhaseTimings, b: PhaseTimings): PhaseTimings {
  const result: PhaseTimings = { PLAN: [], BUILD: [], REVIEW: [], QA: [], SHIP: [] };
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    result[key] = [...(a[key] || []), ...(b[key] || [])];
  }
  return result;
}

function timingsToAverages(timings: PhaseTimings): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const [phase, hours] of Object.entries(timings)) {
    result[phase] = avg(hours);
  }
  return result;
}

// --- Public API ---

export function buildAnalytics(): AnalyticsSummary {
  const projects = getProjects();
  const projectAnalytics: ProjectAnalytics[] = [];

  let totalSprints = 0;
  let completedSprints = 0;
  let activeSprints = 0;
  const allAtomCounts: number[] = [];
  let totalCompliant = 0;
  let totalRelevant = 0;
  let globalTimings: PhaseTimings = { PLAN: [], BUILD: [], REVIEW: [], QA: [], SHIP: [] };

  for (const project of projects) {
    const sprintsDir = join(project.path, '.sprints');
    if (!existsSync(sprintsDir)) {
      projectAnalytics.push({
        id: project.id,
        sprint_count: 0,
        atoms_per_sprint: null,
        chain_compliance_pct: 100,
        avg_time_in_phase: {},
      });
      continue;
    }

    let projectSprintCount = 0;
    const projectAtomCounts: number[] = [];
    let projectCompliant = 0;
    let projectRelevant = 0;
    let projectTimings: PhaseTimings = { PLAN: [], BUILD: [], REVIEW: [], QA: [], SHIP: [] };

    try {
      const entries = readdirSync(sprintsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        const featureDir = join(sprintsDir, entry.name);
        const state = readSprintState(featureDir);
        if (!state) continue;

        projectSprintCount++;
        totalSprints++;

        if (state.phase === 'COMPLETE') {
          completedSprints++;
        } else {
          activeSprints++;
        }

        const atomCount = countAtoms(featureDir);
        if (atomCount > 0) {
          projectAtomCounts.push(atomCount);
          allAtomCounts.push(atomCount);
        }

        // Chain compliance
        const compliant = hasChainCompliance(state.phase_history, state.phase === 'COMPLETE');
        projectRelevant++;
        totalRelevant++;
        if (compliant) {
          projectCompliant++;
          totalCompliant++;
        }

        // Phase timings
        const timings = collectTimings(state.phase_history);
        projectTimings = mergeTimings(projectTimings, timings);
        globalTimings = mergeTimings(globalTimings, timings);
      }
    } catch {
      // Can't read directory
    }

    projectAnalytics.push({
      id: project.id,
      sprint_count: projectSprintCount,
      atoms_per_sprint: avg(projectAtomCounts),
      chain_compliance_pct: projectRelevant > 0
        ? Math.round((projectCompliant / projectRelevant) * 100)
        : 100,
      avg_time_in_phase: timingsToAverages(projectTimings),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    aggregate: {
      total_sprints: totalSprints,
      completed_sprints: completedSprints,
      active_sprints: activeSprints,
      atoms_per_sprint: avg(allAtomCounts),
      chain_compliance_pct: totalRelevant > 0
        ? Math.round((totalCompliant / totalRelevant) * 100)
        : 100,
      avg_time_in_phase: timingsToAverages(globalTimings),
    },
    projects: projectAnalytics,
  };
}
