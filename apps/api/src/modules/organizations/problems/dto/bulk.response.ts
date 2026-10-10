export class BulkResultResponse {
  /** The problem code from the request. */
  code!: string;
  /** done if the action was applied, skipped if not. */
  outcome!: 'done' | 'skipped';
  /** Set when skipped: the code is not a live problem of this organization. */
  reason?: 'not_found';
}

export class BulkProblemsResponse {
  /** One entry per requested code, in request order. */
  results!: BulkResultResponse[];
  /** Number of problems changed. */
  done!: number;
  /** Number of problems left unchanged. */
  skipped!: number;
}
