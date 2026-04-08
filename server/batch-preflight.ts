/**
 * Preflight validation engine for Batch Create.
 * Validates parsed rows against real project/tool sources, detects collisions,
 * and produces launchable vs blocked row outcomes with explicit inline reasons.
 *
 * `preflightRows` accepts all external dependencies as arguments — this keeps
 * the module free of DB/config imports and fully testable without a database.
 *
 * Route handlers (Atom 4) assemble live data and call:
 *   preflightRows(rows, getProjects(), listCliTools({enabledOnly:true}), getAllSessions())
 * No route code should reimplement the validation logic itself.
 */

import { resolve, sep } from 'path';
import { normalizeRowName, type ParsedRow, type ParseResult } from './batch-parse.js';
import type { ProjectConfig } from './sprint-config.js';
import type { CliTool } from './cli-tools.js';

/** Row kinds supported in Slice 1. Anything else is blocked. */
const VALID_ROW_KINDS = new Set(['sprint-existing', 'explore-existing']);

/** A single row after preflight: either launchable or blocked. */
export interface PreflightRow {
  position: number;
  project_id: string;
  row_kind: string;
  normalized_name: string;
  /** Human-readable display label shown in the UI preview. */
  label: string;
  /**
   * The tool's session prefix (e.g. 'cc-'). This is a hint — the final tmux
   * session name will include a generated id assigned at launch time.
   */
  tmux_prefix_hint: string;
  /** Resolved project working directory; empty string when blocked. */
  cwd: string;
  tool_id: string;
  state: 'launchable' | 'blocked';
  blocked_reason: string | null;
}

export interface PreflightResult {
  rows: PreflightRow[];
  launchable_count: number;
  blocked_count: number;
  /** Pass-through from ParseResult.truncated. */
  truncated: boolean;
}

interface ExistingSessionLike {
  name: string;
  status: string;
  cwd?: string | null;
}

function pathBelongsToProject(cwd: string, projectPath: string): boolean {
  const resolvedCwd = resolve(cwd);
  const resolvedProjectPath = resolve(projectPath);
  return resolvedCwd === resolvedProjectPath || resolvedCwd.startsWith(`${resolvedProjectPath}${sep}`);
}

function getProjectIdForSession(session: ExistingSessionLike, projects: ProjectConfig[]): string | null {
  if (!session.cwd) return null;

  const matchedProject = [...projects]
    .sort((a, b) => b.path.length - a.path.length)
    .find((project) => pathBelongsToProject(session.cwd!, project.path));

  return matchedProject?.id ?? null;
}

/**
 * Pure preflight logic. Accepts all external data as arguments so callers
 * (and tests) can inject mock projects, tools, and session lists.
 */
export function preflightRows(
  parsedRows: ParsedRow[],
  projects: ProjectConfig[],
  enabledTools: CliTool[],
  existingSessions: ExistingSessionLike[],
  truncated = false,
): PreflightResult {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const toolMap = new Map(enabledTools.map((t) => [t.id, t]));

  const runningSessionNames = new Set(
    existingSessions
      .filter((s) => s.status === 'running')
      .map((session) => {
        const projectId = getProjectIdForSession(session, projects);
        if (!projectId) return null;
        return `${projectId}:${normalizeRowName(session.name)}`;
      })
      .filter((key): key is string => key !== null),
  );

  // Track within-batch collisions: "project_id:normalized_name" → first position (1-based)
  const seenInBatch = new Map<string, number>();

  const rows: PreflightRow[] = parsedRows.map((parsed) => {
    const normalized = normalizeRowName(parsed.raw_name);

    const blocked = (reason: string): PreflightRow => ({
      position: parsed.position,
      project_id: parsed.project_id,
      row_kind: parsed.row_kind,
      normalized_name: normalized,
      label: parsed.raw_name || '(empty)',
      tmux_prefix_hint: '',
      cwd: '',
      tool_id: parsed.tool_id,
      state: 'blocked',
      blocked_reason: reason,
    });

    // --- Validate project ---
    if (!parsed.project_id) return blocked('project id is required');
    const project = projectMap.get(parsed.project_id);
    if (!project) return blocked(`unknown project '${parsed.project_id}'`);

    // --- Validate row kind ---
    if (!parsed.row_kind) return blocked('row kind is required');
    if (!VALID_ROW_KINDS.has(parsed.row_kind)) {
      return blocked(
        `unsupported row kind '${parsed.row_kind}'; valid kinds: sprint-existing, explore-existing`,
      );
    }

    // --- Validate name ---
    if (!parsed.raw_name.trim() || normalized === 'unnamed') {
      return blocked('name is required');
    }

    // --- Validate tool ---
    const tool = toolMap.get(parsed.tool_id);
    if (!tool) {
      return blocked(`unknown or disabled tool '${parsed.tool_id}'`);
    }

    // --- Within-batch collision ---
    const batchKey = `${parsed.project_id}:${normalized}`;
    const firstSeen = seenInBatch.get(batchKey);
    if (firstSeen !== undefined) {
      return blocked(
        `duplicate: '${normalized}' in project '${parsed.project_id}' already appears at row ${firstSeen}`,
      );
    }
    seenInBatch.set(batchKey, parsed.position + 1);

    // --- Existing running session collision ---
    if (runningSessionNames.has(batchKey)) {
      return blocked(`a running session named '${normalized}' already exists`);
    }

    return {
      position: parsed.position,
      project_id: parsed.project_id,
      row_kind: parsed.row_kind,
      normalized_name: normalized,
      label: `${parsed.project_id} / ${normalized}`,
      tmux_prefix_hint: tool.sessionPrefix,
      cwd: project.path,
      tool_id: parsed.tool_id,
      state: 'launchable',
      blocked_reason: null,
    };
  });

  const launchable_count = rows.filter((r) => r.state === 'launchable').length;
  const blocked_count = rows.filter((r) => r.state === 'blocked').length;

  return { rows, launchable_count, blocked_count, truncated };
}

// Re-export parse primitives so callers can import everything from one place.
export { parseBatchText, normalizeRowName, type ParseResult, type ParsedRow } from './batch-parse.js';
