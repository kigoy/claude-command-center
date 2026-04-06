import { PHASE_ORDER, type Phase } from '../types';

interface Props {
  currentPhase: string;
  phaseHistory: Array<{ phase?: string; exited?: string }>;
  onPhaseClick?: (phase: Phase) => void;
}

const PHASE_LABELS: Record<string, string> = {
  PLAN: 'PLAN',
  BUILD: 'BUILD',
  REVIEW: 'REVIEW',
  QA: 'QA',
  SHIP: 'SHIP',
  COMPLETE: 'DONE',
};

function phaseState(
  phase: Phase,
  currentPhase: string,
  completedPhases: Set<string>,
): 'completed' | 'current' | 'future' {
  if (completedPhases.has(phase)) return 'completed';
  if (phase === currentPhase) return 'current';
  return 'future';
}

export function PhaseStepper({ currentPhase, phaseHistory, onPhaseClick }: Props) {
  const completedPhases = new Set(
    phaseHistory.filter((e) => e.exited && e.phase).map((e) => e.phase!),
  );

  return (
    <div className="phase-stepper">
      {PHASE_ORDER.map((phase, i) => {
        const state = phaseState(phase, currentPhase, completedPhases);
        const isLast = i === PHASE_ORDER.length - 1;
        return (
          <div key={phase} className="phase-stepper-item">
            <button
              className={`phase-step phase-step--${state}`}
              onClick={() => state === 'completed' && onPhaseClick?.(phase)}
              disabled={state === 'future'}
              title={PHASE_LABELS[phase]}
            >
              {PHASE_LABELS[phase]}
            </button>
            {!isLast && <div className={`phase-connector phase-connector--${state}`} />}
          </div>
        );
      })}
    </div>
  );
}
