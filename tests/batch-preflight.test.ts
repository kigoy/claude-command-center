import { describe, it, expect } from 'vitest';
import { preflightRows, type PreflightRow } from '../server/batch-preflight.js';
import type { ParsedRow } from '../server/batch-parse.js';
import type { ProjectConfig } from '../server/sprint-config.js';
import type { CliTool } from '../server/cli-tools.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PROJECTS: ProjectConfig[] = [
  {
    id: 'acme',
    path: '/repos/acme',
    stack: 'node',
    has_deploy: false,
    default_qa_routing: 'has',
  },
  {
    id: 'widget',
    path: '/repos/widget',
    stack: 'python',
    has_deploy: true,
    default_qa_routing: 'has',
  },
];

function makeTool(overrides: Partial<CliTool> = {}): CliTool {
  return {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: [],
    sessionPrefix: 'cc-',
    enabled: true,
    builtIn: true,
    sortOrder: 0,
    promptMode: 'stdin',
    promptArgTemplate: null,
    statusDetection: null,
    env: null,
    notes: null,
    ...overrides,
  };
}

const TOOLS: CliTool[] = [
  makeTool(),
  makeTool({ id: 'gemini', label: 'Gemini CLI', command: 'gemini', sessionPrefix: 'gem-' }),
];

function row(overrides: Partial<ParsedRow> & { position?: number } = {}): ParsedRow {
  return {
    position: 0,
    project_id: 'acme',
    row_kind: 'sprint-existing',
    raw_name: 'auth-flow',
    tool_id: 'claude',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(
  rows: ParsedRow[],
  opts: {
    projects?: ProjectConfig[];
    tools?: CliTool[];
    sessions?: Array<{ name: string; status: string; cwd?: string | null }>;
    truncated?: boolean;
  } = {},
) {
  return preflightRows(
    rows,
    opts.projects ?? PROJECTS,
    opts.tools ?? TOOLS,
    opts.sessions ?? [],
    opts.truncated ?? false,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('preflightRows — happy path', () => {
  it('marks a fully valid row as launchable', () => {
    const result = run([row()]);
    expect(result.rows[0].state).toBe('launchable');
    expect(result.rows[0].blocked_reason).toBeNull();
    expect(result.launchable_count).toBe(1);
    expect(result.blocked_count).toBe(0);
  });

  it('resolves the project cwd', () => {
    const result = run([row()]);
    expect(result.rows[0].cwd).toBe('/repos/acme');
  });

  it('carries the tool session prefix as a hint', () => {
    const result = run([row()]);
    expect(result.rows[0].tmux_prefix_hint).toBe('cc-');
  });

  it('builds the session label as project / normalized-name', () => {
    const result = run([row({ raw_name: 'My Feature' })]);
    expect(result.rows[0].label).toBe('acme / my-feature');
  });

  it('accepts explore-existing row kind', () => {
    const result = run([row({ row_kind: 'explore-existing' })]);
    expect(result.rows[0].state).toBe('launchable');
  });

  it('normalizes the row name', () => {
    const result = run([row({ raw_name: 'Auth  &  Signup' })]);
    expect(result.rows[0].normalized_name).toBe('auth-signup');
  });

  it('accepts a non-default tool', () => {
    const result = run([row({ tool_id: 'gemini' })]);
    expect(result.rows[0].state).toBe('launchable');
    expect(result.rows[0].tmux_prefix_hint).toBe('gem-');
  });

  it('passes truncated flag through to the result', () => {
    const result = run([row()], { truncated: true });
    expect(result.truncated).toBe(true);
  });
});

describe('preflightRows — blocked: project validation', () => {
  it('blocks when project_id is empty', () => {
    const result = run([row({ project_id: '' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/project id is required/);
  });

  it('blocks when project_id is unknown', () => {
    const result = run([row({ project_id: 'unknown-proj' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/unknown project/);
    expect(result.rows[0].blocked_reason).toContain('unknown-proj');
  });
});

describe('preflightRows — blocked: row kind validation', () => {
  it('blocks when row_kind is empty', () => {
    const result = run([row({ row_kind: '' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/row kind is required/);
  });

  it('blocks unsupported row kinds', () => {
    const result = run([row({ row_kind: 'explore-new-project' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/unsupported row kind/);
    expect(result.rows[0].blocked_reason).toContain('explore-new-project');
  });

  it('blocks an arbitrary unknown row kind', () => {
    const result = run([row({ row_kind: 'launch-rocket' })]);
    expect(result.rows[0].state).toBe('blocked');
  });
});

describe('preflightRows — blocked: name validation', () => {
  it('blocks when raw_name is empty', () => {
    const result = run([row({ raw_name: '' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/name is required/);
  });

  it('blocks when raw_name normalizes to unnamed', () => {
    const result = run([row({ raw_name: '---' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/name is required/);
  });
});

describe('preflightRows — blocked: tool validation', () => {
  it('blocks when tool_id is unknown', () => {
    const result = run([row({ tool_id: 'nonexistent-tool' })]);
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/unknown or disabled tool/);
    expect(result.rows[0].blocked_reason).toContain('nonexistent-tool');
  });

  it('blocks when no enabled tools are provided', () => {
    const result = run([row()], { tools: [] });
    expect(result.rows[0].state).toBe('blocked');
  });
});

describe('preflightRows — collision detection', () => {
  it('blocks the second occurrence of the same project + name within the batch', () => {
    const rows: ParsedRow[] = [
      row({ position: 0 }),
      row({ position: 1 }), // same project_id + raw_name
    ];
    const result = run(rows);
    expect(result.rows[0].state).toBe('launchable');
    expect(result.rows[1].state).toBe('blocked');
    expect(result.rows[1].blocked_reason).toMatch(/duplicate/);
    expect(result.rows[1].blocked_reason).toContain('auth-flow');
    expect(result.rows[1].blocked_reason).toContain('acme');
    expect(result.rows[1].blocked_reason).toContain('row 1');
  });

  it('allows duplicate names in different projects', () => {
    const rows: ParsedRow[] = [
      row({ position: 0, project_id: 'acme' }),
      row({ position: 1, project_id: 'widget' }),
    ];
    const result = run(rows);
    expect(result.rows[0].state).toBe('launchable');
    expect(result.rows[1].state).toBe('launchable');
  });

  it('blocks when a running session with the same name already exists', () => {
    const result = run([row()], {
      sessions: [{ name: 'auth-flow', status: 'running', cwd: '/repos/acme/.sprints/feat-auth-flow' }],
    });
    expect(result.rows[0].state).toBe('blocked');
    expect(result.rows[0].blocked_reason).toMatch(/running session/);
    expect(result.rows[0].blocked_reason).toContain('auth-flow');
  });

  it('allows the same running session name in a different project', () => {
    const result = run([row()], {
      sessions: [{ name: 'auth-flow', status: 'running', cwd: '/repos/widget/.sprints/feat-auth-flow' }],
    });
    expect(result.rows[0].state).toBe('launchable');
  });

  it('does not block against non-running sessions', () => {
    const result = run([row()], {
      sessions: [
        { name: 'auth-flow', status: 'dead', cwd: '/repos/acme/.sprints/feat-auth-flow' },
        { name: 'auth-flow', status: 'starting', cwd: '/repos/acme/.sprints/feat-auth-flow' },
      ],
    });
    expect(result.rows[0].state).toBe('launchable');
  });

  it('collision check uses normalized names (case-insensitive match)', () => {
    const result = run([row({ raw_name: 'Auth Flow' })], {
      sessions: [{ name: 'auth-flow', status: 'running', cwd: '/repos/acme/.sprints/feat-auth-flow' }],
    });
    expect(result.rows[0].state).toBe('blocked');
  });
});

describe('preflightRows — mixed batch', () => {
  it('correctly counts launchable and blocked rows in a mixed batch', () => {
    const rows: ParsedRow[] = [
      row({ position: 0 }),
      row({ position: 1, project_id: 'unknown' }),
      row({ position: 2, row_kind: 'bad-kind' }),
      row({ position: 3, raw_name: 'another-feature' }),
    ];
    const result = run(rows);
    expect(result.launchable_count).toBe(2);
    expect(result.blocked_count).toBe(2);
  });

  it('returns rows in input order', () => {
    const rows: ParsedRow[] = [
      row({ position: 0, raw_name: 'first' }),
      row({ position: 1, raw_name: 'second' }),
      row({ position: 2, raw_name: 'third' }),
    ];
    const result = run(rows);
    expect(result.rows.map((r) => r.normalized_name)).toEqual(['first', 'second', 'third']);
  });

  it('blocked rows have empty cwd and tmux_prefix_hint', () => {
    const result = run([row({ project_id: 'unknown' })]);
    expect(result.rows[0].cwd).toBe('');
    expect(result.rows[0].tmux_prefix_hint).toBe('');
  });
});
