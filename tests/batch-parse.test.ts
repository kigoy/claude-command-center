import { describe, it, expect } from 'vitest';
import {
  parseBatchText,
  normalizeRowName,
  MAX_BATCH_ROWS,
  type ParsedRow,
} from '../server/batch-parse.js';

describe('parseBatchText', () => {
  it('parses pipe-delimited rows', () => {
    const result = parseBatchText('my-project | sprint-existing | auth-flow | claude');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject<ParsedRow>({
      position: 0,
      project_id: 'my-project',
      row_kind: 'sprint-existing',
      raw_name: 'auth-flow',
      tool_id: 'claude',
    });
    expect(result.truncated).toBe(false);
    expect(result.total_lines).toBe(1);
  });

  it('parses tab-separated rows (spreadsheet paste)', () => {
    const result = parseBatchText('my-project\tsprint-existing\tauth-flow\tclaude');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      project_id: 'my-project',
      row_kind: 'sprint-existing',
      raw_name: 'auth-flow',
      tool_id: 'claude',
    });
  });

  it('defaults tool_id to claude when omitted', () => {
    const result = parseBatchText('proj | explore-existing | my-idea');
    expect(result.rows[0].tool_id).toBe('claude');
  });

  it('ignores blank lines', () => {
    const input = `
proj | sprint-existing | name-one

proj | sprint-existing | name-two
`;
    const result = parseBatchText(input);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].position).toBe(0);
    expect(result.rows[1].position).toBe(1);
  });

  it('ignores lines starting with #', () => {
    const input = `# This is a header comment
proj | sprint-existing | name-one
# Another comment
proj | sprint-existing | name-two`;
    const result = parseBatchText(input);
    expect(result.rows).toHaveLength(2);
    expect(result.total_lines).toBe(2);
  });

  it('normalises project_id and row_kind to lowercase', () => {
    const result = parseBatchText('MY-PROJECT | SPRINT-EXISTING | Feature Name');
    expect(result.rows[0].project_id).toBe('my-project');
    expect(result.rows[0].row_kind).toBe('sprint-existing');
    // raw_name preserves original casing
    expect(result.rows[0].raw_name).toBe('Feature Name');
  });

  it('caps rows at MAX_BATCH_ROWS and sets truncated flag', () => {
    const lines = Array.from({ length: MAX_BATCH_ROWS + 3 }, (_, i) =>
      `proj | sprint-existing | name-${i}`,
    ).join('\n');
    const result = parseBatchText(lines);
    expect(result.rows).toHaveLength(MAX_BATCH_ROWS);
    expect(result.truncated).toBe(true);
    expect(result.total_lines).toBe(MAX_BATCH_ROWS + 3);
  });

  it('returns truncated false for exactly MAX_BATCH_ROWS rows', () => {
    const lines = Array.from({ length: MAX_BATCH_ROWS }, (_, i) =>
      `proj | sprint-existing | name-${i}`,
    ).join('\n');
    const result = parseBatchText(lines);
    expect(result.rows).toHaveLength(MAX_BATCH_ROWS);
    expect(result.truncated).toBe(false);
  });

  it('parses multiple rows and assigns sequential positions', () => {
    const input = [
      'proj-a | sprint-existing | feature-one',
      'proj-b | explore-existing | research-task | gemini',
    ].join('\n');
    const result = parseBatchText(input);
    expect(result.rows[0].position).toBe(0);
    expect(result.rows[1].position).toBe(1);
    expect(result.rows[1].tool_id).toBe('gemini');
  });

  it('handles empty input', () => {
    const result = parseBatchText('');
    expect(result.rows).toHaveLength(0);
    expect(result.total_lines).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('prefers pipe over tab when both are present on a line', () => {
    // A line with both | and \t should split on |
    const result = parseBatchText('proj\t| sprint-existing\t| name | claude');
    expect(result.rows[0].project_id).toBe('proj');
    expect(result.rows[0].row_kind).toBe('sprint-existing');
    expect(result.rows[0].raw_name).toBe('name');
  });
});

describe('normalizeRowName', () => {
  it('converts spaces to hyphens', () => {
    expect(normalizeRowName('Auth Flow')).toBe('auth-flow');
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalizeRowName('--my-feature--')).toBe('my-feature');
  });

  it('collapses multiple special chars to a single hyphen', () => {
    expect(normalizeRowName('auth  &  signup')).toBe('auth-signup');
  });

  it('returns unnamed for empty input', () => {
    expect(normalizeRowName('')).toBe('unnamed');
    expect(normalizeRowName('   ')).toBe('unnamed');
  });

  it('lowercases the result', () => {
    expect(normalizeRowName('MyFeature')).toBe('myfeature');
  });

  it('preserves hyphens in already-normalized names', () => {
    expect(normalizeRowName('feat-checkout')).toBe('feat-checkout');
  });

  it('handles numeric characters', () => {
    expect(normalizeRowName('sprint-2-auth')).toBe('sprint-2-auth');
  });
});
