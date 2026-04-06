/** Context-aware skill suggestions based on sprint state and project config. */

interface SuggestionContext {
  feature: string;
  phase: string;
  blocked: boolean;
  last_activity: string;
  has_ui: boolean;
}

interface Suggestion {
  skill: string;
  reason: string;
}

/** Auth/payments related patterns in feature names */
const AUTH_PATTERNS = /auth|login|signup|payment|billing|stripe|checkout|session|token|oauth/i;
const UI_PATTERNS = /ui|frontend|dashboard|design|layout|component|page|view/i;

const STALE_HOURS = 48;

function hoursSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return 0;
  return Math.max(0, (Date.now() - then) / (1000 * 60 * 60));
}

/** Generate skill suggestions for a sprint (max 2). */
export function suggestSkills(ctx: SuggestionContext): string[] {
  const suggestions: Suggestion[] = [];

  // BUILD phase + auth/payments patterns → /cso
  if (ctx.phase === 'BUILD' && AUTH_PATTERNS.test(ctx.feature)) {
    suggestions.push({ skill: '/cso', reason: 'auth/payments detected' });
  }

  // Any active phase + has_ui → /design-review
  if (ctx.has_ui && ctx.phase !== 'COMPLETE' && ctx.phase !== 'SHIP') {
    suggestions.push({ skill: '/design-review', reason: 'has UI components' });
  }

  // REVIEW phase + has_ui → /qa
  if (ctx.phase === 'REVIEW' && ctx.has_ui) {
    suggestions.push({ skill: '/qa', reason: 'UI needs QA after review' });
  }

  // SHIP phase → /document-release
  if (ctx.phase === 'SHIP') {
    suggestions.push({ skill: '/document-release', reason: 'ship phase' });
  }

  // Stale BUILD → /investigate
  if (ctx.phase === 'BUILD' && hoursSince(ctx.last_activity) > STALE_HOURS && !ctx.blocked) {
    suggestions.push({ skill: '/investigate', reason: 'stale >48h' });
  }

  // UI-related feature name → /design-review (if not already suggested)
  if (UI_PATTERNS.test(ctx.feature) && !suggestions.some((s) => s.skill === '/design-review') && ctx.phase !== 'COMPLETE') {
    suggestions.push({ skill: '/design-review', reason: 'UI feature detected' });
  }

  // Deduplicate by skill name and limit to 2
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of suggestions) {
    if (!seen.has(s.skill)) {
      seen.add(s.skill);
      unique.push(s.skill);
    }
    if (unique.length >= 2) break;
  }

  return unique;
}
