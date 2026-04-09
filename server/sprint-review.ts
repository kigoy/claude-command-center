import { deriveChainStatus, type SprintState } from './sprint-state.js';
import {
  getLastSprintActivity,
  REVIEW_STALE_VALIDITY_THRESHOLD_MS,
} from '../shared/sprint-health.js';

const PHASE_ORDER = ['PLAN', 'BUILD', 'REVIEW', 'QA', 'SHIP', 'COMPLETE'] as const;
const PHASE_INDEX = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));

export interface SprintReviewFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface SprintReviewReport {
  status: 'green' | 'amber' | 'red';
  still_valid: boolean;
  started: boolean;
  state_correct: boolean;
  summary: string;
  checked_at: string;
  facts: {
    phase: string;
    last_activity: string;
    history_entries: number;
    open_phase_entries: number;
    tmux_active: boolean;
    has_atoms: boolean;
    atoms_total: number;
  };
  findings: SprintReviewFinding[];
}

type HistoryEntry = {
  phase?: string;
  entered?: string;
  exited?: string;
};

function hasValidTimestamp(value?: string): boolean {
  return Boolean(value) && !Number.isNaN(new Date(value!).getTime());
}

function getPhaseIndex(phase?: string): number | null {
  if (!phase) return null;
  return PHASE_INDEX.get(phase as (typeof PHASE_ORDER)[number]) ?? null;
}

export function reviewSprintState(input: {
  state: SprintState;
  tmuxActive: boolean;
  hasAtoms: boolean;
  atomsTotal: number;
  now?: number;
}): SprintReviewReport {
  const { state, tmuxActive, hasAtoms, atomsTotal } = input;
  const now = input.now ?? Date.now();
  const findings: SprintReviewFinding[] = [];
  const history = Array.isArray(state.phase_history) ? (state.phase_history as HistoryEntry[]) : [];

  const addFinding = (severity: SprintReviewFinding['severity'], code: string, message: string) => {
    findings.push({ severity, code, message });
  };

  if (!Array.isArray(state.phase_history)) {
    addFinding('error', 'phase_history_invalid', 'phase_history is missing or not an array.');
  }

  if (getPhaseIndex(state.phase) === null) {
    addFinding('error', 'phase_invalid', `Current phase '${state.phase}' is not recognized.`);
  }

  let previousIndex = -1;
  for (const [index, entry] of history.entries()) {
    const phaseIndex = getPhaseIndex(entry.phase);
    if (phaseIndex === null) {
      addFinding('error', 'history_phase_invalid', `Phase history entry ${index + 1} has an invalid phase.`);
      continue;
    }
    if (!hasValidTimestamp(entry.entered)) {
      addFinding('error', 'history_entered_invalid', `Phase history entry ${index + 1} is missing a valid entered timestamp.`);
    }
    if (entry.exited && !hasValidTimestamp(entry.exited)) {
      addFinding('error', 'history_exited_invalid', `Phase history entry ${index + 1} has an invalid exited timestamp.`);
    }
    if (entry.entered && entry.exited) {
      const entered = new Date(entry.entered).getTime();
      const exited = new Date(entry.exited).getTime();
      if (!Number.isNaN(entered) && !Number.isNaN(exited) && exited < entered) {
        addFinding('error', 'history_exit_before_enter', `Phase history entry ${index + 1} exits before it enters.`);
      }
    }
    if (phaseIndex < previousIndex) {
      addFinding('error', 'history_out_of_order', 'Phase history moves backwards, so the sprint state is inconsistent.');
    }
    previousIndex = Math.max(previousIndex, phaseIndex);
  }

  const openEntries = history.filter((entry) => !entry.exited);
  if (history.length === 0) {
    addFinding('warning', 'history_empty', 'No phase history recorded yet.');
  } else if (openEntries.length === 0) {
    addFinding('error', 'history_open_missing', 'No open phase entry matches the current sprint phase.');
  } else if (openEntries.length > 1) {
    addFinding('error', 'history_open_multiple', 'More than one open phase entry exists.');
  } else if (openEntries[0].phase !== state.phase) {
    addFinding('error', 'history_phase_mismatch', `Current phase '${state.phase}' does not match the open history entry '${openEntries[0].phase || 'unknown'}'.`);
  }

  const chain = deriveChainStatus(state);
  if (chain.qa_required && ['SHIP', 'COMPLETE'].includes(state.phase) && !chain.qa_done) {
    addFinding('error', 'qa_missing', 'Sprint is in SHIP/COMPLETE with UI QA required but no QA completion recorded.');
  }

  if (state.blocked && !state.blocked_reason?.trim()) {
    addFinding('warning', 'blocked_reason_missing', 'Sprint is blocked but no blocked_reason is set.');
  }

  if (tmuxActive && state.phase === 'COMPLETE') {
    addFinding('warning', 'complete_tmux_active', 'Sprint is marked COMPLETE while its tmux session is still active.');
  }

  const started = tmuxActive
    || state.phase !== 'PLAN'
    || hasAtoms
    || atomsTotal > 0
    || history.some((entry) => entry.phase !== 'PLAN' || Boolean(entry.exited));

  const lastActivity = getLastSprintActivity(state);
  if (!hasValidTimestamp(lastActivity)) {
    addFinding('warning', 'last_activity_invalid', 'Last activity timestamp is invalid, so recency cannot be trusted.');
  } else if (state.phase !== 'COMPLETE' && now - new Date(lastActivity).getTime() > REVIEW_STALE_VALIDITY_THRESHOLD_MS) {
    addFinding('warning', 'stale_validity', 'Sprint has been idle for more than 7 days. Review whether it is still valid.');
  }

  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  const stillValid = errors.length === 0 && !warnings.some((finding) => finding.code === 'stale_validity');
  const stateCorrect = errors.length === 0;

  let summary = 'Sprint looks healthy.';
  if (!stateCorrect) {
    summary = 'Sprint state is inconsistent and needs manual cleanup.';
  } else if (!stillValid) {
    summary = 'Sprint state is structurally valid, but it looks stale and should be revalidated.';
  } else if (!started) {
    summary = 'Sprint is valid but does not appear to have started yet.';
  } else if (warnings.length > 0) {
    summary = 'Sprint is usable, with warnings worth checking.';
  }

  return {
    status: !stateCorrect ? 'red' : warnings.length > 0 || !started ? 'amber' : 'green',
    still_valid: stillValid,
    started,
    state_correct: stateCorrect,
    summary,
    checked_at: new Date(now).toISOString(),
    facts: {
      phase: state.phase,
      last_activity: lastActivity,
      history_entries: history.length,
      open_phase_entries: openEntries.length,
      tmux_active: tmuxActive,
      has_atoms: hasAtoms,
      atoms_total: atomsTotal,
    },
    findings,
  };
}
