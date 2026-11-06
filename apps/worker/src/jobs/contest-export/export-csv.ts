import { writeCsv } from '@libs/common';

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

export const exportCsv = (rows: readonly ExportRow[]): string =>
  writeCsv([
    HEADER,
    ...rows.map((row) => [
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
    ]),
  ]);
