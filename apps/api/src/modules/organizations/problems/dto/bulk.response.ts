export class BulkResultResponse {
  code!: string;
  outcome!: 'done' | 'skipped';
  /** Set when skipped: the code is not a live problem of this organization. */
  reason?: 'not_found';
}

export class BulkProblemsResponse {
  results!: BulkResultResponse[];
  done!: number;
  skipped!: number;
}
