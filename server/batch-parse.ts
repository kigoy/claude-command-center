/**
 * Pure parser for Batch Create input text.
 * Accepts pipe-delimited (teaching format) or tab-separated (spreadsheet paste) rows,
 * one per line. No database access or filesystem reads in this module.
 */

export const MAX_BATCH_ROWS = 20;

/** A single parsed (but not yet validated) row from batch input text. */
export interface ParsedRow {
  /** 0-based index in the active (capped) row list. */
  position: number;
  project_id: string;
  row_kind: string;
  /** Name as typed, before normalization. */
  raw_name: string;
  /** Defaults to 'claude' when omitted. */
  tool_id: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** true when the input contained more rows than MAX_BATCH_ROWS. */
  truncated: boolean;
  /** Total non-blank, non-comment input lines before the cap. */
  total_lines: number;
}

/** Split one input line into fields. Accepts | or tab as delimiter. */
function splitLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.includes('|')) {
    return trimmed.split('|').map((f) => f.trim());
  }
  return trimmed.split('\t').map((f) => f.trim());
}

/** Parse free-form batch input text into raw row data. */
export function parseBatchText(text: string): ParseResult {
  const inputLines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith('#');
    });

  const total_lines = inputLines.length;
  const truncated = total_lines > MAX_BATCH_ROWS;
  const activeLines = truncated ? inputLines.slice(0, MAX_BATCH_ROWS) : inputLines;

  const rows: ParsedRow[] = activeLines.map((line, i) => {
    const fields = splitLine(line);
    const [rawProject = '', rawKind = '', rawName = '', rawTool = ''] = fields;
    return {
      position: i,
      project_id: rawProject.toLowerCase().trim(),
      row_kind: rawKind.toLowerCase().trim(),
      raw_name: rawName.trim(),
      tool_id: (rawTool.trim() || 'claude').toLowerCase(),
    };
  });

  return { rows, truncated, total_lines };
}

/**
 * Normalize a row name to kebab-case.
 * Returns 'unnamed' for empty or whitespace-only input.
 */
export function normalizeRowName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed'
  );
}
