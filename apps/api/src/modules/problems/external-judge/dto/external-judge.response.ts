export class ExternalJudgeLanguageResponse {
  /** Site language id. */
  languageId!: string;
  /** The remote OJ's language id. */
  remoteId!: string;
  /** The remote OJ's language name. */
  remoteName!: string;
}

export class ExternalJudgeLinkResponse {
  /** Whether submissions go to the external judge. */
  isActive!: boolean;
  oj!: string;
  problemId!: string;
  /** Remote title from the last verify. */
  title!: string;
  languages!: ExternalJudgeLanguageResponse[];
  /** When the link was last verified; null if never. */
  verifiedAt!: Date | null;
}

export class ProblemExternalJudgeResponse {
  /** Whether the site has an external judge connection configured. */
  connected!: boolean;
  /** The problem's link; null when none. */
  link!: ExternalJudgeLinkResponse | null;
}

export class ExternalJudgeTestResponse {
  ok!: true;
  /** OJ ids the external judge serves. */
  ojs!: string[];
}

export class ExternalJudgeStatusResponse {
  /** Whether an external judge is configured. */
  enabled!: boolean;
  /** Whether the last check reached it; null when not configured. */
  reachable!: boolean | null;
  /** When the last check ran (ISO 8601); null when not configured. */
  checkedAt!: string | null;
  /** OJ ids it serves; empty when unreachable. */
  ojs!: string[];
}

export class ExternalJudgeSearchItemResponse {
  oj!: string;
  problemId!: string;
  title!: string;
  source!: string;
}

export class ExternalJudgeSearchResponse {
  items!: ExternalJudgeSearchItemResponse[];
  total!: number;
  page!: number;
  pageSize!: number;
}

export class ExternalJudgeVerifyLanguageResponse {
  remoteId!: string;
  remoteName!: string;
  /** The site language this one most likely is; null when no good match. */
  suggestedLanguageId!: string | null;
}

export class ExternalJudgeVerifyResponse {
  oj!: string;
  problemId!: string;
  title!: string;
  languages!: ExternalJudgeVerifyLanguageResponse[];
}
