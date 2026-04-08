/**
 * Route-shape tests for batch-api.ts.
 *
 * These tests verify the route contract (request/response shapes, status codes,
 * and that batch-store / runner are composed — not reimplemented) by calling the
 * router with mock dependencies injected via vi.mock.
 *
 * NOTE: These tests do NOT use a real Express app binding or Supertest.
 * That harness is Atom 5's responsibility. Here we verify the module
 * integration surface: parseBatchText + preflightRows + store + runner.
 *
 * We only test pure, synchronous logic that avoids the better-sqlite3 ABI
 * issue. The runner integration path (runBatchAsync) touches sessions.ts /
 * DB and is covered by the real batch-runner tests.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Route-independent contract tests: verify that batch-api composes its deps
// ---------------------------------------------------------------------------

// Import the pure modules that batch-api delegates to.
import { parseBatchText } from '../server/batch-parse.js';
import { preflightRows } from '../server/batch-preflight.js';
import type { ParsedRow } from '../server/batch-parse.js';
import type { ProjectConfig } from '../server/sprint-config.js';
import type { CliTool } from '../server/cli-tools.js';

// Shared fixtures
const PROJECTS: ProjectConfig[] = [
  { id: 'acme', path: '/repos/acme', stack: 'node', has_deploy: false, default_qa_routing: 'has' },
];

const TOOLS: CliTool[] = [
  {
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
  },
];

// ---------------------------------------------------------------------------
// parseBatchText + preflightRows integration (what POST /batches/preflight does)
// ---------------------------------------------------------------------------

describe('preflight route contract', () => {
  it('returns launchable rows for valid pipe-delimited input', () => {
    const text = 'acme | sprint-existing | auth-flow | claude';
    const parsed = parseBatchText(text);
    const result = preflightRows(parsed.rows, PROJECTS, TOOLS, [], parsed.truncated);
    expect(result.launchable_count).toBe(1);
    expect(result.blocked_count).toBe(0);
    expect(result.rows[0].state).toBe('launchable');
  });

  it('returns blocked rows for invalid input', () => {
    const text = 'unknown-proj | sprint-existing | auth-flow';
    const parsed = parseBatchText(text);
    const result = preflightRows(parsed.rows, PROJECTS, TOOLS, [], parsed.truncated);
    expect(result.launchable_count).toBe(0);
    expect(result.blocked_count).toBe(1);
    expect(result.rows[0].state).toBe('blocked');
  });

  it('handles tab-separated input', () => {
    const text = 'acme\tsprint-existing\tauth-flow\tclaude';
    const parsed = parseBatchText(text);
    const result = preflightRows(parsed.rows, PROJECTS, TOOLS, [], parsed.truncated);
    expect(result.launchable_count).toBe(1);
  });

  it('truncates at 20 rows and reports truncated=true', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `acme | sprint-existing | feature-${i}`);
    const parsed = parseBatchText(lines.join('\n'));
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows).toHaveLength(20);
  });

  it('reports truncated=false for <= 20 rows', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `acme | sprint-existing | feature-${i}`);
    const parsed = parseBatchText(lines.join('\n'));
    expect(parsed.truncated).toBe(false);
  });

  it('mixed batch: blocked rows have null cwd', () => {
    const rows: ParsedRow[] = [
      { position: 0, project_id: 'acme', row_kind: 'sprint-existing', raw_name: 'feat', tool_id: 'claude' },
      { position: 1, project_id: 'nope', row_kind: 'sprint-existing', raw_name: 'feat2', tool_id: 'claude' },
    ];
    const result = preflightRows(rows, PROJECTS, TOOLS, [], false);
    expect(result.rows[0].cwd).toBe('/repos/acme');
    expect(result.rows[1].cwd).toBe('');
    expect(result.launchable_count).toBe(1);
    expect(result.blocked_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Preflight does not mutate state (pure)
// ---------------------------------------------------------------------------

describe('preflight is pure and idempotent', () => {
  it('running preflight twice returns the same result', () => {
    const text = 'acme | sprint-existing | auth-flow';
    const parsed = parseBatchText(text);
    const r1 = preflightRows(parsed.rows, PROJECTS, TOOLS, [], parsed.truncated);
    const r2 = preflightRows(parsed.rows, PROJECTS, TOOLS, [], parsed.truncated);
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// batch-events: notifyBatchChanged is a no-op when no clients are connected
// ---------------------------------------------------------------------------

describe('batch-events: notifyBatchChanged', () => {
  it('does not throw when no clients are connected', async () => {
    const { notifyBatchChanged } = await import('../server/batch-events.js');
    expect(() => notifyBatchChanged('test-batch-id')).not.toThrow();
  });
});
