import { invalidField } from '@libs/common';
import type { Problem, Submission } from '@libs/database';
import type { ScoreOverrideDto } from './dto/score-override.dto';

export type OverriddenScore = Pick<
  Submission,
  'result' | 'points' | 'casePoints' | 'caseTotal'
>;

/**
 * The stored score of a manual override. Contest points and "solved" read `casePoints / caseTotal`, and a problem
 * rescore recomputes `points` from them, so the fraction is stored on the problem's own scale (`caseTotal` = its
 * points): every reader agrees with the points asked for, and a rescore keeps them. A problem without partial points
 * would score anything but full marks as 0, so only 0 or full is taken there.
 */
export function overriddenScore(
  { result, points }: Pick<ScoreOverrideDto, 'result' | 'points'>,
  problem: Pick<Problem, 'points' | 'partial'>,
): OverriddenScore {
  if (points > problem.points)
    throw invalidField(
      'points',
      `At most the problem's ${problem.points} points.`,
      'points_above_problem',
    );
  const isFull = points === problem.points;
  if (!problem.partial && !isFull && points !== 0)
    throw invalidField(
      'points',
      'This problem has no partial points: give 0 or full points.',
      'points_not_partial',
    );
  if (result === 'AC' && !isFull)
    throw invalidField(
      'result',
      'Accepted needs full points.',
      'accepted_needs_full_points',
    );
  return { result, points, casePoints: points, caseTotal: problem.points };
}
