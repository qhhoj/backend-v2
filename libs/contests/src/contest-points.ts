import { submissionPoints } from '@libs/judging';
import type { FormatName } from './formats/format';

/** Legacy `update_contest`: the case ratio of the contest problem's points; partial only when both the contest problem and the problem are, except FSO, which is always partial. */
export const contestSubmissionPoints = (
  totals: { casePoints: number; caseTotal: number },
  contestProblem: { points: number; partial: boolean },
  formatName: FormatName,
  problemPartial: boolean,
): number =>
  submissionPoints(
    totals.casePoints,
    totals.caseTotal,
    contestProblem.points,
    formatName === 'final_submission' ||
      (contestProblem.partial && problemPartial),
  );

/** Formats that score a contest submission from its cases even on a non-partial problem (ioi16: per-batch credit; final_submission: partial points), so its run must judge every case. */
export const scoresEveryCase = (formatName: FormatName): boolean =>
  formatName === 'ioi16' || formatName === 'final_submission';
