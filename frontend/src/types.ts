/** Shared types for the sprint dashboard */

export interface CliToolStatusDetection {
  runningPatterns: string[];
  waitingPatterns: string[];
  deadPatterns: string[];
}

export interface CliTool {
  id: string;
  label: string;
  command: string;
  args: string[];
  sessionPrefix: string;
  enabled: boolean;
  builtIn: boolean;
  sortOrder: number;
  promptMode: 'none' | 'stdin' | 'arg';
  promptArgTemplate: string | null;
  statusDetection: CliToolStatusDetection | null;
  env: Record<string, string> | null;
  notes: string | null;
}

export interface ChainStatus {
  plan_done: boolean;
  review_done: boolean;
  qa_done: boolean;
  qa_required: boolean;
}

export interface SprintSummary {
  feature: string;
  phase: string;
  archived?: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  last_activity: string;
  branch: string;
  tmux_session: string;
  tmux_active: boolean;
  tool_id: string;
  chain_status: ChainStatus;
  suggestions?: string[];
  created: string;
  phase_history: Array<{ phase?: string; entered?: string; exited?: string }>;
}

export interface ProjectSummary {
  id: string;
  path: string;
  stack: string;
  has_deploy: boolean;
  deploy_url?: string;
  path_exists: boolean;
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

export interface PendingQuestion {
  requestId: string;
  sessionId: string;
  question: string;
  options: string[];
  allowText: boolean;
  createdAt: number;
  sessionName: string | null;
  toolId: string | null;
}

export interface SprintDetail {
  feature: string;
  branch: string;
  created: string;
  phase: string;
  archived?: boolean;
  phase_history: PhaseHistoryEntry[];
  activity_history: SprintHistoryEvent[];
  qa_routing: Record<string, unknown>;
  blocked: boolean;
  blocked_reason: string | null;
  atoms_total: number;
  atoms_completed: number;
  has_atoms: boolean;
  tmux_session: string;
  tmux_active: boolean;
  tool_id: string;
  chain_status: ChainStatus;
  learnings?: string[];
}

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

export interface SprintHistoryEvent {
  ts: string;
  kind: 'system' | 'action' | 'status' | 'implementation';
  title: string;
  detail?: string;
  phase?: string;
  source: 'activity' | 'phase' | 'derived';
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
  agentActive: boolean;
}
