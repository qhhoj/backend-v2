export interface ExportRow {
  submissionId: string;
  participationId: string;
  username: string;
  problem: string;
  language: string;
  submittedAt: Date;
  /** Seconds from the participation's own start. */
  contestSeconds: number;
  status: string;
  result: string | null;
  points: number;
  isDisqualified: boolean;
  /** For the source's file name. */
  extension: string;
  /** False for a problem deleted since the contest: its sources are for their owners and staff only, so only the CSV row is exported. */
  hasSource: boolean;
}

/** A spreadsheet runs a cell that starts with one of these as a formula: a username may start with them. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 quoting, and a leading `'` before anything a spreadsheet would execute; numbers are written as they are. */
export function csvCell(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const HEADER = [
  'submission_id',
  'participation_id',
  'username',
  'problem',
  'language',
  'submitted_at',
  'contest_seconds',
  'status',
  'result',
  'points',
  'disqualified',
];

export function exportCsv(rows: readonly ExportRow[]): string {
  const lines = rows.map((row) =>
    [
      row.submissionId,
      row.participationId,
      row.username,
      row.problem,
      row.language,
      row.submittedAt.toISOString(),
      row.contestSeconds,
      row.status,
      row.result ?? '',
      row.points,
      row.isDisqualified,
    ]
      .map(csvCell)
      .join(','),
  );
  return `${[HEADER.join(','), ...lines].join('\r\n')}\r\n`;
}
