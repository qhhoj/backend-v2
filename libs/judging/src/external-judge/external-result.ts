import type { CaseStatus } from '@libs/database';
import type { RemoteRun } from './external-judge-types';

/** The remote verdicts the legacy `STATUS_MAP` graded, in v2 case statuses. */
const VERDICTS: Record<string, CaseStatus> = {
  AC: 'AC',
  WA: 'WA',
  PE: 'WA',
  TLE: 'TLE',
  TIMEOUT: 'TLE',
  MLE: 'MLE',
  OLE: 'OLE',
  RE: 'RTE',
  RTE: 'RTE',
  IR: 'IR',
};

const PROCESSING_CANONICALS = new Set([
  'PENDING',
  'QUEUED',
  'POLLING',
  'PROCESSING',
  'RUNNING',
  'SUBMITTING',
]);
const PROCESSING_SYSTEM_STATUSES = new Set([
  '',
  'pending',
  'queued',
  'polling',
  'processing',
  'running',
  'submitting',
]);

export const UNSUPPORTED_STATUS_MESSAGE =
  'The external judge returned an unsupported status';
export const SUBMIT_FAILED_MESSAGE =
  'The external judge refused this submission';
const INTERNAL_ERROR_MESSAGE =
  'The external judge failed to judge this submission';

/** Points on a 0-100 scale: the run is graded as one case worth 100, so `submissionPoints` turns it into the problem's points. */
export const EXTERNAL_CASE_TOTAL = 100;

export interface ExternalCase {
  status: CaseStatus;
  /** Seconds. */
  time: number;
  /** KB. */
  memory: number;
  points: number;
  total: number;
  /** The remote score text, if any. */
  feedback: string;
}

export type ExternalOutcome =
  | { kind: 'processing' }
  | { kind: 'graded'; testCase: ExternalCase }
  | { kind: 'compile-error'; log: string }
  | { kind: 'internal-error'; message: string };

/** Still judging unless the answer says `processing: false` and neither status is a processing one (legacy poll guard: an empty status is not final). */
export function isProcessing(run: RemoteRun): boolean {
  return (
    run.processing !== false ||
    PROCESSING_SYSTEM_STATUSES.has(run.systemStatus) ||
    PROCESSING_CANONICALS.has(run.statusCanonical)
  );
}

/** The submit was refused by the external judge (it never reached the remote OJ). */
export function isSubmitFailed(run: RemoteRun): boolean {
  return (
    run.statusCanonical.startsWith('SUBMIT_FAILED') ||
    run.systemStatus.startsWith('submit_failed')
  );
}

/** `"a/b"` is a fraction, otherwise the first number is a percentage; clamped to 0-100, null when unreadable. */
export function scorePercent(scoreText: string | null): number | null {
  if (!scoreText) return null;
  const fraction = /(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/.exec(scoreText);
  if (fraction) {
    const total = Number(fraction[2]);
    return total > 0 ? clampPercent((Number(fraction[1]) / total) * 100) : null;
  }
  const number = /-?\d+(?:\.\d+)?/.exec(scoreText);
  return number ? clampPercent(Number(number[0])) : null;
}

const clampPercent = (value: number): number =>
  Math.min(100, Math.max(0, value));

/**
 * A remote answer in v2 terms (legacy `finalize_external_submission`): a full score is AC whatever the verdict; on a partial problem a
 * score gives proportional points, and turns an IE or CE verdict into WA; an unknown final verdict is IE.
 */
export function mapExternalResult(
  run: RemoteRun,
  problem: { partial: boolean },
): ExternalOutcome {
  if (isSubmitFailed(run))
    return {
      kind: 'internal-error',
      message: run.errorMessage ?? SUBMIT_FAILED_MESSAGE,
    };
  if (isProcessing(run)) return { kind: 'processing' };
  const percent = scorePercent(run.scoreText);
  const verdict = VERDICTS[run.statusCanonical];
  if (percent === 100 || verdict === 'AC')
    return graded(run, 'AC', EXTERNAL_CASE_TOTAL);
  const scored = percent !== null && problem.partial;
  if (verdict) return graded(run, verdict, scored ? percent : 0);
  if (scored) return graded(run, 'WA', percent);
  if (run.statusCanonical === 'CE')
    return { kind: 'compile-error', log: run.errorMessage ?? '' };
  if (run.statusCanonical === 'IE')
    return {
      kind: 'internal-error',
      message: run.errorMessage ?? INTERNAL_ERROR_MESSAGE,
    };
  return {
    kind: 'internal-error',
    message: run.errorMessage ?? UNSUPPORTED_STATUS_MESSAGE,
  };
}

function graded(
  run: RemoteRun,
  status: CaseStatus,
  points: number,
): ExternalOutcome {
  return {
    kind: 'graded',
    testCase: {
      status,
      time: run.runtimeMs === null ? 0 : run.runtimeMs / 1000,
      memory: run.memoryKb ?? 0,
      points,
      total: EXTERNAL_CASE_TOTAL,
      feedback: run.scoreText ?? '',
    },
  };
}
