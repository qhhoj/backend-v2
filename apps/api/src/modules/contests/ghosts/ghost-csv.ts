import type { GhostCell, GhostInput } from '@libs/contests';
import {
  CONTROL_CHARACTER,
  CsvRankingError,
  GHOST_CAPTION_MAX,
  GHOST_LABEL_MAX,
  GHOST_LIMIT,
  readCsvRecords,
} from '@libs/contests';

/** Machine codes of a refused ghost CSV; the SPA words each one itself. `label_invalid` and `caption_invalid` mean "too long"; a leading = + - @ has its own `label_formula` and `caption_formula`. */
export const GHOST_CSV_ISSUE_CODES = [
  'label_missing',
  'label_formula',
  'label_repeats',
  'label_invalid',
  'caption_invalid',
  'caption_formula',
  'control_character',
  'cell_invalid',
  'columns_mismatch',
  'header_invalid',
  'csv_invalid',
  'too_many_ghosts',
] as const;
export type GhostCsvIssueCode = (typeof GHOST_CSV_ISSUE_CODES)[number];

/** `row` is the 1-based CSV row (the header is row 1); absent when the whole file is at fault. */
export interface GhostCsvIssue {
  code: GhostCsvIssueCode;
  row?: number;
  message: string;
}

export interface GhostCsvResult {
  ghosts: GhostInput[];
  issues: GhostCsvIssue[];
  /** The issue messages, each prefixed `Row N: ` when it has a row. */
  errors: string[];
}

/** `[points@]minute[+rejected]`: at most 99 rejected tries (each becomes a synthetic row to score); points with at most 5 integer and 6 decimal digits, so exporting them never yields an exponent. */
const CELL = /^(?:(\d{1,5}(?:\.\d{1,6})?)@)?(\d{1,5})(?:\+(\d{1,2}))?$/;
/** A spreadsheet would run these as formulas. */
const FORMULA_START = /^[=+\-@]/;
const MAX_REPORTED_ISSUES = 50;
const FIXED_COLUMNS = 2;
const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;

const rowIssue = (
  code: GhostCsvIssueCode,
  row: number | undefined,
  message: string,
): GhostCsvIssue =>
  row === undefined ? { code, message } : { code, row, message };

const issueMessage = (issue: GhostCsvIssue): string =>
  issue.row === undefined
    ? issue.message
    : `Row ${issue.row}: ${issue.message}`;

const failed = (issues: GhostCsvIssue[]): GhostCsvResult => {
  const reported = issues.slice(0, MAX_REPORTED_ISSUES);
  return { ghosts: [], issues: reported, errors: reported.map(issueMessage) };
};

/** Null: an empty cell (unsolved). 'invalid': outside the grammar. */
export function parseGhostCell(
  text: string,
  problemId: string,
): GhostCell | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = CELL.exec(trimmed);
  const points = match?.[1] === undefined ? null : Number(match[1]);
  if (!match || points === 0) return 'invalid';
  return {
    problemId,
    minute: Number(match[2]),
    rejectedBefore: match[3] === undefined ? null : Number(match[3]),
    points,
  };
}

function labelIssues(label: string, row: number): GhostCsvIssue[] {
  if (label.trim() === '')
    return [rowIssue('label_missing', row, 'the label is empty')];
  const issues: GhostCsvIssue[] = [];
  if (label.length > GHOST_LABEL_MAX)
    issues.push(
      rowIssue(
        'label_invalid',
        row,
        `the label is longer than ${GHOST_LABEL_MAX} characters`,
      ),
    );
  if (FORMULA_START.test(label))
    issues.push(
      rowIssue('label_formula', row, 'the label starts with = + - or @'),
    );
  return issues;
}

function textIssues(
  label: string,
  caption: string,
  row: number,
): GhostCsvIssue[] {
  const issues = labelIssues(label, row);
  if (caption.length > GHOST_CAPTION_MAX)
    issues.push(
      rowIssue(
        'caption_invalid',
        row,
        `the caption is longer than ${GHOST_CAPTION_MAX} characters`,
      ),
    );
  if (FORMULA_START.test(caption))
    issues.push(
      rowIssue('caption_formula', row, 'the caption starts with = + - or @'),
    );
  if (CONTROL_CHARACTER.test(label) || CONTROL_CHARACTER.test(caption))
    issues.push(
      rowIssue('control_character', row, 'a field holds a control character'),
    );
  return issues;
}

/** The problem id of each problem column, plus the header's issues (row 1). */
function headerColumns(
  header: string[],
  problemIds: ReadonlyMap<string, string>,
): { columns: string[]; issues: GhostCsvIssue[] } {
  if (header[0] !== 'label' || header[1] !== 'caption')
    return {
      columns: [],
      issues: [
        rowIssue(
          'header_invalid',
          HEADER_ROW,
          'The header must start with label,caption',
        ),
      ],
    };
  const issues: GhostCsvIssue[] = [];
  const columns: string[] = [];
  for (const code of header.slice(FIXED_COLUMNS)) {
    const problemId = problemIds.get(code);
    if (problemId === undefined)
      issues.push(
        rowIssue(
          'columns_mismatch',
          HEADER_ROW,
          `Column "${code}" is not a problem of this contest`,
        ),
      );
    else if (columns.includes(problemId))
      issues.push(
        rowIssue('columns_mismatch', HEADER_ROW, `Column "${code}" repeats`),
      );
    else columns.push(problemId);
  }
  return { columns, issues };
}

function cellIssue(text: string, row: number): GhostCsvIssue {
  return rowIssue(
    'cell_invalid',
    row,
    `the cell "${text}" is not minute, minute+rejected (at most 99) or points@minute`,
  );
}

function parseGhostRow(
  fields: string[],
  row: number,
  columns: readonly string[],
  labels: Set<string>,
): { ghost?: GhostInput; issues: GhostCsvIssue[] } {
  const expected = columns.length + FIXED_COLUMNS;
  if (fields.length !== expected)
    return {
      issues: [
        rowIssue(
          'columns_mismatch',
          row,
          `expected ${expected} fields, got ${fields.length}`,
        ),
      ],
    };
  const [label, caption] = fields;
  const issues = textIssues(label, caption, row);
  if (labels.has(label))
    issues.push(rowIssue('label_repeats', row, 'the label repeats'));
  labels.add(label);
  const texts = fields.slice(FIXED_COLUMNS);
  const parsed = columns.map((problemId, index) =>
    parseGhostCell(texts[index], problemId),
  );
  issues.push(
    ...texts.flatMap((text, index) =>
      parsed[index] === 'invalid' ? [cellIssue(text, row)] : [],
    ),
  );
  const cells = parsed.filter(
    (cell): cell is GhostCell => cell !== null && cell !== 'invalid',
  );
  return issues.length === 0
    ? { ghost: { label, caption, cells }, issues }
    : { issues };
}

function readRecords(csv: string): {
  records: string[][];
  issues: GhostCsvIssue[];
} {
  try {
    return { records: readCsvRecords(csv), issues: [] };
  } catch (error) {
    if (!(error instanceof CsvRankingError)) throw error;
    return {
      records: [],
      issues: [rowIssue('csv_invalid', undefined, error.message)],
    };
  }
}

/** QHHOJ's own grammar: header `label,caption,<problemCode>...`; `problemIds` maps a contest problem's code to its id. Nothing is returned unless every row is valid. */
export function parseGhostCsv(
  csv: string,
  problemIds: ReadonlyMap<string, string>,
): GhostCsvResult {
  const { records, issues: readIssues } = readRecords(csv);
  if (readIssues.length) return failed(readIssues);
  const [header, ...lines] = records;
  if (!header)
    return failed([rowIssue('csv_invalid', undefined, 'The CSV is empty')]);
  const { columns, issues: headerIssues } = headerColumns(header, problemIds);
  if (headerIssues.length) return failed(headerIssues);
  if (lines.length > GHOST_LIMIT)
    return failed([
      rowIssue('too_many_ghosts', undefined, `More than ${GHOST_LIMIT} ghosts`),
    ]);
  const labels = new Set<string>();
  const rows = lines.map((fields, index) =>
    parseGhostRow(fields, index + FIRST_DATA_ROW, columns, labels),
  );
  const issues = rows.flatMap((row) => row.issues);
  if (issues.length) return failed(issues);
  return {
    ghosts: rows.flatMap((row) => (row.ghost ? [row.ghost] : [])),
    issues: [],
    errors: [],
  };
}

/** Labels may be real students' names: "Ghost 001", "Ghost 002", in order. */
export const anonymizeLabels = (ghosts: readonly GhostInput[]): GhostInput[] =>
  ghosts.map((ghost, index) => ({
    ...ghost,
    label: `Ghost ${String(index + 1).padStart(3, '0')}`,
  }));

const quote = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const cellText = (cell: GhostCell): string =>
  `${cell.points === null ? '' : `${cell.points}@`}${cell.minute}${cell.rejectedBefore === null ? '' : `+${cell.rejectedBefore}`}`;

/** The current set in the import grammar, so it can be downloaded, edited and uploaded again. */
export function ghostsToCsv(
  ghosts: readonly GhostInput[],
  columns: ReadonlyArray<{ problemId: string; code: string }>,
): string {
  const header = ['label', 'caption', ...columns.map((column) => column.code)];
  const rows = ghosts.map((ghost) => ghostRowOf(ghost, columns));
  return `${[header, ...rows].map((fields) => fields.map(quote).join(',')).join('\r\n')}\r\n`;
}

function ghostRowOf(
  ghost: GhostInput,
  columns: ReadonlyArray<{ problemId: string; code: string }>,
): string[] {
  const cellByProblem = new Map(
    ghost.cells.map((cell) => [cell.problemId, cell]),
  );
  return [
    ghost.label,
    ghost.caption,
    ...columns.map((column) => {
      const cell = cellByProblem.get(column.problemId);
      return cell ? cellText(cell) : '';
    }),
  ];
}
