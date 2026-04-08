export interface AutoSprintAction {
  command: string;
  toPhase: string;
  label: string;
}

export function getAutoSprintAction(input: {
  phase: string;
  qaRequired: boolean;
}): AutoSprintAction | null {
  const { phase, qaRequired } = input;

  switch (phase) {
    case 'PLAN':
      return { command: '/office-hours', toPhase: 'PLAN', label: 'Auto It' };
    case 'BUILD':
      return { command: '/review', toPhase: 'REVIEW', label: 'Auto It' };
    case 'REVIEW':
      return qaRequired
        ? { command: '/qa', toPhase: 'QA', label: 'Auto It' }
        : { command: '/ship', toPhase: 'SHIP', label: 'Auto It' };
    case 'QA':
      return { command: '/ship', toPhase: 'SHIP', label: 'Auto It' };
    default:
      return null;
  }
}
