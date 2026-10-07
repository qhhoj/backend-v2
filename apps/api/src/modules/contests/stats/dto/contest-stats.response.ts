export class ContestProblemResultsResponse {
  AC!: number;
  WA!: number;
  CE!: number;
  TLE!: number;
  /** MLE, OLE, IR, RTE, AB and IE together. */
  ERR!: number;
  RJ!: number;
}

export class ContestProblemStatsResponse {
  problemId!: string;
  code!: string;
  name!: string;
  label!: string;
  results!: ContestProblemResultsResponse;
  /** Every submission, pending ones included. */
  total!: number;
  /** Percentage of `total`. */
  acRate!: number;
}

export class ContestLanguageStatsResponse {
  languageId!: string;
  name!: string;
  count!: number;
  /** Percentage of `count`. */
  acRate!: number;
}

export class ContestStatsResponse {
  problems!: ContestProblemStatsResponse[];
  /** Most used first. */
  languages!: ContestLanguageStatsResponse[];
}
