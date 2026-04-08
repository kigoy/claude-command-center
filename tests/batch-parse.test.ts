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

  it('treats whitespace-only lines as blank', () => {
    const input = 'proj | sprint-existing | a\n   \t  \nproj | sprint-existing | b';
    const result = parseBatchText(input);
    expect(result.rows).toHaveLength(2);
    expect(result.total_lines).toBe(2);
  });

  it('parses lines with fewer than 3 columns (missing fields)', () => {
    const result = parseBatchText('proj | sprint-existing');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].project_id).toBe('proj');
    expect(result.rows[0].row_kind).toBe('sprint-existing');
    expect(result.rows[0].raw_name).toBe('');
    expect(result.rows[0].tool_id).toBe('claude');
  });

  it('parses lines with only one column', () => {
    const result = parseBatchText('just-a-project');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].project_id).toBe('just-a-project');
    expect(result.rows[0].row_kind).toBe('');
    expect(result.rows[0].raw_name).toBe('');
  });

  it('ignores extra columns beyond the 4th', () => {
    const result = parseBatchText('proj | sprint-existing | feat | claude | extra | bonus');
    expect(result.rows[0].tool_id).toBe('claude');
    // The extra fields are silently discarded
    expect(result.rows).toHaveLength(1);
  });

  it('trims trailing whitespace from input lines', () => {
    const result = parseBatchText('proj | sprint-existing | feat   \n');
    expect(result.rows[0].raw_name).toBe('feat');
  });

  it('lowercases tool_id', () => {
    const result = parseBatchText('proj | sprint-existing | feat | GEMINI');
    expect(result.rows[0].tool_id).toBe('gemini');
  });

  it('handles mixed pipe and tab rows across lines', () => {
    const input = 'proj | sprint-existing | a | claude\nproj\tsprint-existing\tb\tclaude';
    const result = parseBatchText(input);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].raw_name).toBe('a');
    expect(result.rows[1].raw_name).toBe('b');
  });

  it('handles row cap boundary: exactly MAX_BATCH_ROWS + 1 lines', () => {
    const lines = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) =>
      `proj | sprint-existing | name-${i}`,
    ).join('\n');
    const result = parseBatchText(lines);
    expect(result.rows).toHaveLength(MAX_BATCH_ROWS);
    expect(result.truncated).toBe(true);
    expect(result.total_lines).toBe(MAX_BATCH_ROWS + 1);
    // Last included row should be at position MAX_BATCH_ROWS - 1
    expect(result.rows[MAX_BATCH_ROWS - 1].position).toBe(MAX_BATCH_ROWS - 1);
  });

  it('comments and blanks do not count toward the row cap', () => {
    const commentLines = Array.from({ length: 10 }, () => '# comment').join('\n');
    const dataLines = Array.from({ length: 5 }, (_, i) =>
      `proj | sprint-existing | name-${i}`,
    ).join('\n');
    const result = parseBatchText(`${commentLines}\n${dataLines}`);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(false);
    expect(result.total_lines).toBe(5);
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

  it('normalizes unicode/special characters to hyphens', () => {
    expect(normalizeRowName('café-flow')).toBe('caf-flow');
    expect(normalizeRowName('feat@v2')).toBe('feat-v2');
  });

  it('collapses consecutive non-alnum runs to one hyphen', () => {
    expect(normalizeRowName('a...b___c')).toBe('a-b-c');
  });

  it('returns unnamed for input that normalizes to empty', () => {
    expect(normalizeRowName('---')).toBe('unnamed');
    expect(normalizeRowName('!!!')).toBe('unnamed');
    expect(normalizeRowName('@#$')).toBe('unnamed');
  });
});
