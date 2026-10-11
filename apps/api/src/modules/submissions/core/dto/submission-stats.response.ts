export class VerdictCountResponse {
  /** Result code, such as `AC` or `WA`. */
  result!: string;
  /** Submissions judged today with this result. */
  count!: number;
}

export class SubmissionStatsResponse {
  /** Submissions judged since midnight in the site time zone. */
  judgedToday!: number;
  /** Those among them that were accepted. */
  acceptedToday!: number;
  /** Today's judged submissions by result, most frequent first; their counts add up to `judgedToday`. */
  verdictsToday!: VerdictCountResponse[];
  /** Submissions queued or being judged now. */
  queueLength!: number;
  /** Usable judges that are connected. */
  judgesOnline!: number;
  /** Judges that are neither blocked nor disabled. */
  judgesTotal!: number;
}
