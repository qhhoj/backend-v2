import type { ProblemData } from '@libs/database';

/** judge-v2 2.3.6 runs `interactive.checker` and reads a bridged checker's `files` as a list (source, then headers); it advertises both as this one Hello feature. Older judges answer either with an internal error, so such a problem goes only to judges that advertise it. */
export const INTERACTIVE_CHECKER_FEATURE = 'interactive.checker';
/** judge-v2 reads `interactive.treat_checker_points_as_percentage` (the interactor's `quitp(x)` is x% of the case) and advertises it as this Hello feature. Older judges refuse an unknown `interactive` key with an internal error, so only judges that advertise it get such a problem. */
export const INTERACTOR_PERCENT_FEATURE = 'interactive.percentage';

/** The parts of a problem's data that decide what its init.yml asks of a judge. */
export type JudgedData = Pick<
  ProblemData,
  'grader' | 'graderArgs' | 'checker' | 'helperHeaders' | 'interactiveChecker'
>;

/** init.yml names an `interactive.checker`. */
export const runsInteractiveChecker = (data: JudgedData): boolean =>
  data.grader === 'interactive' && Boolean(data.interactiveChecker);

/** init.yml reads the interactor's points as a percentage of the case (Polygon's "treat points from checker as percent"). */
export const interactorPointsArePercent = (data: JudgedData): boolean =>
  data.grader === 'interactive' &&
  data.graderArgs?.treat_checker_points_as_percentage === true;

/** The headers a bridged checker compiles with; init.yml then lists them after its source. */
export const checkerHeadersOf = (data: JudgedData): string[] =>
  data.checker === 'bridged' ? (data.helperHeaders ?? []) : [];

/** Hello features a judge needs to grade the problem; empty for every problem an older judge grades. */
export function requiredJudgeFeatures(data: JudgedData): string[] {
  const needsNewJudge =
    runsInteractiveChecker(data) || checkerHeadersOf(data).length > 0;
  return [
    ...(needsNewJudge ? [INTERACTIVE_CHECKER_FEATURE] : []),
    ...(interactorPointsArePercent(data) ? [INTERACTOR_PERCENT_FEATURE] : []),
  ];
}
