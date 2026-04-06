/** Shared types for the sprint dashboard */

export interface ChainStatus {
  plan_done: boolean;
  review_done: boolean;
  qa_done: boolean;
  qa_required: boolean;
}

export interface SprintSummary {
  feature: string;
  phase: string;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  last_activity: string;
  branch: string;
  tmux_session: string;
  tmux_active: boolean;
  chain_status: ChainStatus;
  suggestions?: string[];
}

export interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  sprints: SprintSummary[];
}

export interface GroupConfig {
  id: string;
  label: string;
  projects: string[];
}

export interface DashboardData {
  groups: GroupConfig[];
  projects: ProjectSummary[];
  recommendations: Array<{
    text: string;
    project: string;
    feature: string;
    phase: string;
    effort_minutes: number;
    score: number;
  }>;
  recommendation: string;
}

export interface SprintDetail {
  feature: string;
  branch: string;
  created: string;
  phase: string;
  phase_history: PhaseHistoryEntry[];
  qa_routing: Record<string, unknown>;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  tmux_session: string;
  tmux_active: boolean;
  chain_status: ChainStatus;
  learnings?: string[];
}

export interface PhaseHistoryEntry {
  phase?: string;
  entered?: string;
  exited?: string;
  skills_run?: string[];
  decisions?: string[];
  atoms_total?: number;
  atoms_completed?: number;
  last_atom?: string;
  e2e_gate?: string;
  qa_result?: string;
  sections?: string[];
  commit?: string;
  pushed?: string;
  summary?: string;
}

/** All possible sprint phases in order */
export const PHASE_ORDER = ['PLAN', 'BUILD', 'REVIEW', 'QA', 'SHIP', 'COMPLETE'] as const;
export type Phase = (typeof PHASE_ORDER)[number];

/** Tmux session detected by the background poller */
export interface TmuxSession {
  sessionName: string;
  projectId: string;
  feature: string;
  claudeActive: boolean;
}
