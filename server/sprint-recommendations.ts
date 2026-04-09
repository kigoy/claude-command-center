// --- Types ---

export interface SprintContext {
  projectId: string;
  feature: string;
  phase: string;
  archived?: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  last_activity: string;
}

export interface Recommendation {
  text: string;
  project: string;
  feature: string;
  phase: string;
  effort_minutes: number;
  score: number;
}

// --- Scoring weights ---

/** Phase priority: closer to shipping = higher weight */
const PHASE_WEIGHT: Record<string, number> = {
  SHIP: 50,
  REVIEW: 40,
  QA: 35,
  BUILD: 20,
  PLAN: 10,
  COMPLETE: 0,
};

const BLOCKED_PENALTY = 50;
const QUICK_WIN_BONUS = 15;
const QUICK_WIN_THRESHOLD = 2; // atoms remaining
const STALENESS_FACTOR = 0.5; // points per hour since last activity

// --- Effort estimation ---

/** Estimate minutes remaining based on phase and atoms left */
function estimateEffort(phase: string, atomsRemaining: number): number {
  if (phase === 'SHIP') return 5;
  if (phase === 'REVIEW') return 10;
  if (phase === 'QA') return 15;
  // BUILD/PLAN: ~15 min per atom remaining, minimum 10
  return Math.max(10, atomsRemaining * 15);
}

/** Hours since the given ISO timestamp */
function hoursSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return 0;
  return Math.max(0, (Date.now() - then) / (1000 * 60 * 60));
}

// --- Action text ---

function actionText(ctx: SprintContext, effort: number): string {
  const label = `${ctx.projectId}/${ctx.feature}`;
  const effortTag = `~${effort}min`;

  switch (ctx.phase) {
    case 'SHIP':
      return `Ship ${label} (${effortTag})`;
    case 'REVIEW':
      return `Review ${label} (${effortTag})`;
    case 'QA':
      return `QA ${label} (${effortTag})`;
    case 'BUILD': {
      const remaining = ctx.atoms_total - ctx.atoms_completed;
      return `Continue ${label} BUILD (${remaining} atoms, ${effortTag})`;
    }
    case 'PLAN':
      return `Plan ${label} (${effortTag})`;
    default:
      return `${ctx.phase} ${label} (${effortTag})`;
  }
}

// --- Core scoring ---

function scoreSprint(ctx: SprintContext): number {
  if (ctx.phase === 'COMPLETE') return -1;

  const phaseScore = PHASE_WEIGHT[ctx.phase] ?? 10;
  const staleness = hoursSince(ctx.last_activity) * STALENESS_FACTOR;
  const blocked = ctx.blocked ? -BLOCKED_PENALTY : 0;
  const atomsRemaining = ctx.atoms_total - ctx.atoms_completed;
  const quickWin = atomsRemaining > 0 && atomsRemaining <= QUICK_WIN_THRESHOLD ? QUICK_WIN_BONUS : 0;

  return phaseScore + staleness + blocked + quickWin;
}

// --- Public API ---

/** Rank all sprints and return top N recommendations */
export function rankRecommendations(sprints: SprintContext[], limit = 3): Recommendation[] {
  const scored = sprints
    .filter((s) => s.phase !== 'COMPLETE' && s.archived !== true)
    .map((ctx) => {
      const score = scoreSprint(ctx);
      const atomsRemaining = ctx.atoms_total - ctx.atoms_completed;
      const effort = estimateEffort(ctx.phase, atomsRemaining);
      return {
        text: actionText(ctx, effort),
        project: ctx.projectId,
        feature: ctx.feature,
        phase: ctx.phase,
        effort_minutes: effort,
        score,
      };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
