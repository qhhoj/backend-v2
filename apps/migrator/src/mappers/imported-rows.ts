/** Keeps only `judge_problem` rows the `problems` job imports (it skips a problem whose group is gone). */
export const importedProblem = (alias: string): string =>
  `JOIN judge_problemgroup ${alias}_group ON ${alias}_group.id = ${alias}.group_id`;

/** Keeps only `judge_submission` rows the `submissions` job imports: user profile, language and an imported problem exist. */
export const importedSubmission = (alias: string): string =>
  `JOIN judge_profile ${alias}_user ON ${alias}_user.id = ${alias}.user_id
   JOIN judge_language ${alias}_language ON ${alias}_language.id = ${alias}.language_id
   JOIN judge_problem ${alias}_problem ON ${alias}_problem.id = ${alias}.problem_id
   ${importedProblem(`${alias}_problem`)}`;

/** Keeps only `judge_contestparticipation` rows the participations job imports: contest and user profile exist. */
export const importedParticipation = (alias: string): string =>
  `JOIN judge_contest ${alias}_contest ON ${alias}_contest.id = ${alias}.contest_id
   JOIN judge_profile ${alias}_user ON ${alias}_user.id = ${alias}.user_id`;
