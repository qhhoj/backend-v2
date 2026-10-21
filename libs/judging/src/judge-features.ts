import type { ProblemData } from '@libs/database';

/** judge-v2 2.3.6 runs `interactive.checker` and reads a bridged checker's `files` as a list (source, then headers); it advertises both as this one Hello feature. Older judges answer either with an internal error, so such a problem goes only to judges that advertise it. */
export const INTERACTIVE_CHECKER_FEATURE = 'interactive.checker';

/** The parts of a problem's data that decide what its init.yml asks of a judge. */
export type JudgedData = Pick<
  ProblemData,
  'grader' | 'checker' | 'helperHeaders' | 'interactiveChecker'
>;

/** init.yml names an `interactive.checker`. */
export const runsInteractiveChecker = (data: JudgedData): boolean =>
  data.grader === 'interactive' && Boolean(data.interactiveChecker);

/** The headers a bridged checker compiles with; init.yml then lists them after its source. */
export const checkerHeadersOf = (data: JudgedData): string[] =>
  data.checker === 'bridged' ? (data.helperHeaders ?? []) : [];

/** Hello features a judge needs to grade the problem; empty for every problem an older judge grades. */
export function requiredJudgeFeatures(data: JudgedData): string[] {
  const needsNewJudge =
    runsInteractiveChecker(data) || checkerHeadersOf(data).length > 0;
  return needsNewJudge ? [INTERACTIVE_CHECKER_FEATURE] : [];
}
