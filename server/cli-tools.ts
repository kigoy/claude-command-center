import db from './db.js';

export type PromptMode = 'none' | 'stdin' | 'arg';

export interface StatusDetection {
  runningPatterns: string[];
  waitingPatterns: string[];
  deadPatterns: string[];
}

interface CliToolRow {
  id: string;
  label: string;
  command: string;
  args_json: string;
  session_prefix: string;
  enabled: number;
  built_in: number;
  sort_order: number;
  prompt_mode: PromptMode;
  prompt_arg_template: string | null;
  status_detection_json: string | null;
  env_json: string | null;
  notes: string | null;
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
  promptMode: PromptMode;
  promptArgTemplate: string | null;
  statusDetection: StatusDetection | null;
  env: Record<string, string> | null;
  notes: string | null;
}

export interface CliToolInput {
  id: string;
  label: string;
  command: string;
  args?: string[];
  sessionPrefix: string;
  enabled?: boolean;
  builtIn?: boolean;
  sortOrder?: number;
  promptMode?: PromptMode;
  promptArgTemplate?: string | null;
  statusDetection?: StatusDetection | null;
  env?: Record<string, string> | null;
  notes?: string | null;
}

const claudeDetection: StatusDetection = {
  runningPatterns: [
    '[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●∙]',
    'thinking',
    'processing',
    'reading',
    'writing',
  ],
  waitingPatterns: [
    'Do you want to proceed\\?',
    'allow|approve|deny|yes.*no',
  ],
  deadPatterns: [],
};

const copilotDetection: StatusDetection = {
  runningPatterns: [
    '\\[pending\\]',
    '◎ Loading',
    '● \\w+',
  ],
  waitingPatterns: [
    'Do you want to run this command\\?',
    '↑↓ to navigate',
    'Yes, and approve',
  ],
  deadPatterns: [],
};

const BUILT_IN_TOOLS: CliToolInput[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: ['--permission-mode', 'bypassPermissions'],
    sessionPrefix: 'cc-',
    enabled: true,
    builtIn: true,
    sortOrder: 0,
    promptMode: 'stdin',
    promptArgTemplate: null,
    statusDetection: claudeDetection,
    env: null,
    notes: null,
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    command: 'gh',
    args: ['copilot', '--', '--yolo'],
    sessionPrefix: 'ghc-',
    enabled: true,
    builtIn: true,
    sortOrder: 1,
    promptMode: 'stdin',
    promptArgTemplate: null,
    statusDetection: copilotDetection,
    env: null,
    notes: null,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    args: ['--approval-mode', 'yolo'],
    sessionPrefix: 'gem-',
    enabled: true,
    builtIn: true,
    sortOrder: 2,
    promptMode: 'stdin',
    promptArgTemplate: null,
    statusDetection: null,
    env: null,
    notes: null,
  },
];

const stmts = {
  list: db.prepare('SELECT * FROM cli_tools ORDER BY sort_order ASC, label COLLATE NOCASE ASC'),
  listEnabled: db.prepare('SELECT * FROM cli_tools WHERE enabled = 1 ORDER BY sort_order ASC, label COLLATE NOCASE ASC'),
  get: db.prepare('SELECT * FROM cli_tools WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO cli_tools (
      id, label, command, args_json, session_prefix, enabled, built_in, sort_order,
      prompt_mode, prompt_arg_template, status_detection_json, env_json, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  update: db.prepare(`
    UPDATE cli_tools
    SET label = ?, command = ?, args_json = ?, session_prefix = ?, enabled = ?, built_in = ?,
        sort_order = ?, prompt_mode = ?, prompt_arg_template = ?, status_detection_json = ?,
        env_json = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  updateEnabled: db.prepare(`
    UPDATE cli_tools SET enabled = ?, updated_at = datetime('now') WHERE id = ?
  `),
  updateSortOrder: db.prepare(`
    UPDATE cli_tools SET sort_order = ?, updated_at = datetime('now') WHERE id = ?
  `),
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const LEGACY_BUILT_IN_ARGS: Record<string, string[]> = {
  claude: [],
  copilot: ['copilot'],
  gemini: [],
};

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rowToCliTool(row: CliToolRow): CliTool {
  return {
    id: row.id,
    label: row.label,
    command: row.command,
    args: parseJson<string[]>(row.args_json, []),
    sessionPrefix: row.session_prefix,
    enabled: row.enabled === 1,
    builtIn: row.built_in === 1,
    sortOrder: row.sort_order,
    promptMode: row.prompt_mode,
    promptArgTemplate: row.prompt_arg_template,
    statusDetection: parseJson<StatusDetection | null>(row.status_detection_json, null),
    env: parseJson<Record<string, string> | null>(row.env_json, null),
    notes: row.notes,
  };
}

function serializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function normalizeTool(input: CliToolInput): CliToolInput {
  const id = input.id.trim();
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
    throw new Error(`Invalid tool id '${input.id}'`);
  }

  const label = input.label.trim();
  const command = input.command.trim();
  const sessionPrefix = input.sessionPrefix.trim();
  if (!label) throw new Error('Tool label is required');
  if (!command) throw new Error('Tool command is required');
  if (!sessionPrefix) throw new Error('Tool sessionPrefix is required');

  return {
    id,
    label,
    command,
    args: (input.args ?? []).map((arg) => arg.trim()).filter(Boolean),
    sessionPrefix,
    enabled: input.enabled ?? true,
    builtIn: input.builtIn ?? false,
    sortOrder: input.sortOrder ?? 0,
    promptMode: input.promptMode ?? 'none',
    promptArgTemplate: input.promptArgTemplate ?? null,
    statusDetection: input.statusDetection ?? null,
    env: input.env ?? null,
    notes: input.notes?.trim() || null,
  };
}

function persistTool(tool: CliToolInput) {
  stmts.insert.run(
    tool.id,
    tool.label,
    tool.command,
    serializeJson(tool.args) ?? '[]',
    tool.sessionPrefix,
    tool.enabled ? 1 : 0,
    tool.builtIn ? 1 : 0,
    tool.sortOrder ?? 0,
    tool.promptMode ?? 'none',
    tool.promptArgTemplate ?? null,
    serializeJson(tool.statusDetection),
    serializeJson(tool.env),
    tool.notes ?? null,
  );
}

export function seedBuiltInCliTools() {
  for (const tool of BUILT_IN_TOOLS) {
    const existing = getCliTool(tool.id);
    if (!existing) {
      persistTool(tool);
      continue;
    }
    const shouldBackfillPromptMode = existing.promptMode === 'none' && tool.promptMode !== 'none';
    const shouldBackfillDetection = !existing.statusDetection && !!tool.statusDetection;
    const shouldBackfillArgs = arraysEqual(existing.args, LEGACY_BUILT_IN_ARGS[tool.id] || []);
    if (shouldBackfillPromptMode || shouldBackfillDetection || shouldBackfillArgs) {
      stmts.update.run(
        existing.label, existing.command,
        serializeJson(shouldBackfillArgs ? (tool.args ?? []) : existing.args) ?? '[]', existing.sessionPrefix,
        existing.enabled ? 1 : 0, 1,
        existing.sortOrder, shouldBackfillPromptMode ? tool.promptMode : existing.promptMode,
        existing.promptArgTemplate, serializeJson(tool.statusDetection),
        serializeJson(existing.env), existing.notes, tool.id,
      );
    }
  }
}

export function listCliTools(opts?: { enabledOnly?: boolean }): CliTool[] {
  const rows = (opts?.enabledOnly ? stmts.listEnabled : stmts.list).all() as CliToolRow[];
  return rows.map(rowToCliTool);
}

export function getCliTool(id: string): CliTool | null {
  const row = stmts.get.get(id) as CliToolRow | undefined;
  return row ? rowToCliTool(row) : null;
}

export function createCliTool(input: CliToolInput): CliTool {
  const normalized = normalizeTool({
    ...input,
    sortOrder: input.sortOrder ?? listCliTools().length,
  });
  if (getCliTool(normalized.id)) {
    throw new Error(`CLI tool '${normalized.id}' already exists`);
  }

  persistTool(normalized);
  return getCliTool(normalized.id)!;
}

export function updateCliTool(id: string, patch: Partial<CliToolInput>): CliTool {
  const existing = getCliTool(id);
  if (!existing) {
    throw new Error(`CLI tool '${id}' not found`);
  }

  const merged = normalizeTool({
    id: existing.id,
    label: patch.label ?? existing.label,
    command: patch.command ?? existing.command,
    args: patch.args ?? existing.args,
    sessionPrefix: patch.sessionPrefix ?? existing.sessionPrefix,
    enabled: patch.enabled ?? existing.enabled,
    builtIn: existing.builtIn,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    promptMode: patch.promptMode ?? existing.promptMode,
    promptArgTemplate: patch.promptArgTemplate ?? existing.promptArgTemplate,
    statusDetection: patch.statusDetection ?? existing.statusDetection,
    env: patch.env ?? existing.env,
    notes: patch.notes ?? existing.notes,
  });

  stmts.update.run(
    merged.label,
    merged.command,
    serializeJson(merged.args) ?? '[]',
    merged.sessionPrefix,
    merged.enabled ? 1 : 0,
    existing.builtIn ? 1 : 0,
    merged.sortOrder ?? 0,
    merged.promptMode ?? 'none',
    merged.promptArgTemplate ?? null,
    serializeJson(merged.statusDetection),
    serializeJson(merged.env),
    merged.notes ?? null,
    id,
  );
  return getCliTool(id)!;
}

export function setCliToolEnabled(id: string, enabled: boolean): CliTool {
  const existing = getCliTool(id);
  if (!existing) {
    throw new Error(`CLI tool '${id}' not found`);
  }
  stmts.updateEnabled.run(enabled ? 1 : 0, id);
  return getCliTool(id)!;
}

export function reorderCliTools(orderedIds: string[]): CliTool[] {
  const uniqueIds = [...new Set(orderedIds)];
  const tools = listCliTools();
  const remaining = tools
    .map((tool) => tool.id)
    .filter((id) => !uniqueIds.includes(id));
  const finalOrder = [...uniqueIds, ...remaining];

  const updateOrder = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      if (getCliTool(id)) {
        stmts.updateSortOrder.run(index, id);
      }
    });
  });

  updateOrder(finalOrder);
  return listCliTools();
}

function nextDuplicateId(baseId: string): string {
  let attempt = `${baseId}-copy`;
  let index = 2;
  while (getCliTool(attempt)) {
    attempt = `${baseId}-copy-${index}`;
    index++;
  }
  return attempt;
}

export function duplicateCliTool(id: string): CliTool {
  const existing = getCliTool(id);
  if (!existing) {
    throw new Error(`CLI tool '${id}' not found`);
  }

  const duplicate = createCliTool({
    id: nextDuplicateId(id),
    label: `${existing.label} Copy`,
    command: existing.command,
    args: existing.args,
    sessionPrefix: `${existing.sessionPrefix}copy-`,
    enabled: false,
    builtIn: false,
    sortOrder: listCliTools().length,
    promptMode: existing.promptMode,
    promptArgTemplate: existing.promptArgTemplate,
    statusDetection: existing.statusDetection,
    env: existing.env,
    notes: existing.notes,
  });

  return duplicate;
}
