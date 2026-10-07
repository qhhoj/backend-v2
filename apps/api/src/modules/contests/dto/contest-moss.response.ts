export class ContestMossResultResponse {
  problemId!: string;
  code!: string;
  label!: string;
  /** MOSS language common name (`C++`, `Python`, ...). */
  language!: string;
  submissionCount!: number;
  /** Null when no submission qualified. */
  url!: string | null;
}

export class ContestMossResponse {
  /** A MOSS run is queued or in progress for this contest. */
  running!: boolean;
  /** Contest problem order, then MOSS language order. */
  results!: ContestMossResultResponse[];
}
