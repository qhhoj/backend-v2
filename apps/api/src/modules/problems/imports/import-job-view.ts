import {
  IMPORT_STEPS,
  POLYGON_ERROR_PREFIX,
  RETRYABLE_IMPORT_ERRORS,
} from '@libs/problems';
import type {
  ImportProgress,
  ImportStep,
  PolygonImportResult,
} from '@libs/problems';
import type {
  ImportJobResponse,
  ImportResultResponse,
} from './dto/import-job.response';
import type { ImportJob } from './import-queue';

/** Longest import error shown; worker messages can echo problem.xml text. */
const MAX_SHOWN_REASON = 1000;
const GENERIC_FAILURE = 'Import failed';

/** A job as the status page shows it; `state` is its BullMQ state, `queuePosition` its place while it waits. */
export function importJobView(
  job: ImportJob,
  state: string,
  queuePosition: number | null,
): ImportJobResponse {
  // A job waiting again (a stalled job put back, a retry) still holds its old progress: only a running job shows one.
  const progress = state === 'active' ? progressOf(job.progress) : null;
  const failed = state === 'failed';
  const errorCode = failed ? (job.data.errorCode ?? null) : null;
  return {
    id: job.id ?? '',
    code: job.data.code,
    mode: job.data.mode,
    purpose: job.data.polygon?.purpose ?? null,
    state,
    step: stepOf(state, progress),
    progress,
    queuePosition,
    result: resultOf(job.returnvalue),
    error: failed ? shownReason(job.failedReason ?? '') : null,
    errorCode,
    errorParams: errorCode ? (job.data.errorParams ?? {}) : null,
    retryable: errorCode !== null && RETRYABLE_IMPORT_ERRORS.has(errorCode),
    failedStep: failed ? (job.data.failedStep ?? null) : null,
    createdAt: new Date(job.timestamp),
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
  };
}

const resultOf = (
  result: PolygonImportResult | null | undefined,
): ImportResultResponse | null =>
  result
    ? {
        problemId: result.problemId,
        code: result.code,
        summary: result.summary ?? null,
        localEdits: result.localEdits ?? null,
        attention: result.attention ?? null,
      }
    : null;

/** The worker reports `{step, done, total}`; anything else (a job queued before progress existed) reads as none. */
const progressOf = (progress: unknown): ImportProgress | null =>
  typeof progress === 'object' &&
  progress !== null &&
  IMPORT_STEPS.includes((progress as ImportProgress).step)
    ? (progress as ImportProgress)
    : null;

const stepOf = (state: string, progress: ImportProgress | null): ImportStep => {
  if (state === 'completed') return 'done';
  if (state === 'failed') return 'failed';
  return progress?.step ?? 'queued';
};

/** Only a failure the worker wrote for the requester is shown; the rest may carry paths and driver details. */
const shownReason = (reason: string): string =>
  reason.startsWith(POLYGON_ERROR_PREFIX)
    ? reason.slice(
        POLYGON_ERROR_PREFIX.length,
        POLYGON_ERROR_PREFIX.length + MAX_SHOWN_REASON,
      )
    : GENERIC_FAILURE;
