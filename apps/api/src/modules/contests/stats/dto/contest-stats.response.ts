export class ContestProblemResultsResponse {
  /** Accepted submissions. */
  AC!: number;
  /** Wrong answer submissions. */
  WA!: number;
  /** Compile error submissions. */
  CE!: number;
  /** Time limit exceeded submissions. */
  TLE!: number;
  /** MLE, OLE, IR, RTE, AB and IE together. */
  ERR!: number;
  /** Rejected submissions. */
  RJ!: number;
}

export class ContestProblemStatsResponse {
  problemId!: string;
  code!: string;
  name!: string;
  /** The problem's label in the contest. */
  label!: string;
  /** Submission counts per result. */
  results!: ContestProblemResultsResponse;
  /** Every submission, pending ones included. */
  total!: number;
  /** Percentage of `total`. */
  acRate!: number;
}

export class ContestLanguageStatsResponse {
  languageId!: string;
  /** Language name. */
  name!: string;
  /** Submissions in this language. */
  count!: number;
  /** Percentage of `count`. */
  acRate!: number;
}

export class ContestStatsResponse {
  /** Statistics per contest problem, in contest order. */
  problems!: ContestProblemStatsResponse[];
  /** Most used first. */
  languages!: ContestLanguageStatsResponse[];
}
