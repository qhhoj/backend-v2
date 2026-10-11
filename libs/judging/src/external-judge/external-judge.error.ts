/** Why an external judge call failed, as a stable code the api maps to an HTTP answer and the UI to a message. */
export const EXTERNAL_JUDGE_ERROR_CODES = [
  'external_judge_not_configured',
  'external_judge_unauthorized',
  'external_judge_not_found',
  'external_judge_rejected',
  'external_judge_unavailable',
] as const;
export type ExternalJudgeErrorCode =
  (typeof EXTERNAL_JUDGE_ERROR_CODES)[number];

/** Fixed texts: a message never carries the base URL, the token, the request or the remote body, so it is safe to show and to log. */
const MESSAGES: Record<ExternalJudgeErrorCode, string> = {
  external_judge_not_configured:
    'The external judge is not configured (externalJudge.baseUrl and externalJudge.apiToken)',
  external_judge_unauthorized: 'The external judge refused the API token',
  external_judge_not_found: 'The external judge does not know this problem',
  external_judge_rejected: 'The external judge refused the request',
  external_judge_unavailable: 'The external judge is not available',
};

export class ExternalJudgeError extends Error {
  constructor(
    readonly code: ExternalJudgeErrorCode,
    /** The HTTP status the external judge answered, for logs; null for a network failure. */
    readonly status: number | null = null,
  ) {
    super(MESSAGES[code]);
    this.name = 'ExternalJudgeError';
  }

  /** Worth trying again later: the service or the network failed, not the request. */
  get isTransient(): boolean {
    return this.code === 'external_judge_unavailable';
  }
}

/** The code an HTTP status maps to (legacy client): 401/403 token, 404 unknown, 429 and 5xx unavailable, other 4xx refused. */
export function errorCodeOfStatus(status: number): ExternalJudgeErrorCode {
  if (status === 401 || status === 403) return 'external_judge_unauthorized';
  if (status === 404) return 'external_judge_not_found';
  if (status === 429 || status >= 500) return 'external_judge_unavailable';
  return 'external_judge_rejected';
}
