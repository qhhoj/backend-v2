export class SubmissionStatsResponse {
  /** Submissions judged since midnight in the site time zone. */
  judgedToday!: number;
  /** Those among them that were accepted. */
  acceptedToday!: number;
  /** Submissions queued or being judged now. */
  queueLength!: number;
  /** Usable judges that are connected. */
  judgesOnline!: number;
  /** Judges that are neither blocked nor disabled. */
  judgesTotal!: number;
}
