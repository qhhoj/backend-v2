import { UnrecoverableError } from 'bullmq';
import { JobFailure } from '@libs/common';
import type { ImportErrorParams, PolygonImportErrorCode } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';

/** What a failure the requester may not see reads as; the api shows the same text. */
export const GENERIC_FAILURE = 'Import failed';
/** The api shows at most this much of an import error; the history keeps the same. */
const MAX_RECORDED_ERROR = 1000;

/** Why a job failed, as recorded on the job, the link and the history. */
export interface ImportFailure {
  code: PolygonImportErrorCode;
  params: ImportErrorParams;
  /** The text shown to the requester. */
  message: string;
}

export function importFailureOf(error: unknown): ImportFailure {
  if (error instanceof PolygonImportError)
    return {
      code: error.code,
      params: error.params,
      message: error.message.slice(0, MAX_RECORDED_ERROR),
    };
  return { code: 'import_failed', params: {}, message: GENERIC_FAILURE };
}

/** The error BullMQ records: a `PolygonImportError` as a `JobFailure` the api shows; anything else (paths, driver details) under its own message, for the logs only. `final`: no attempt is left. */
export function recordedErrorOf(error: unknown, final: boolean): Error {
  if (error instanceof PolygonImportError)
    return new JobFailure(error.message, final);
  const message = error instanceof Error ? error.message : String(error);
  return final ? new UnrecoverableError(message) : new Error(message);
}
