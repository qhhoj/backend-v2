import type { ImportErrorParams, PolygonImportErrorCode } from '@libs/problems';
import { POLYGON_ERROR_PREFIX } from '@libs/problems';
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
  /** The job's failure reason: a `PolygonImportError` carries the prefix the api looks for; anything else (paths, driver details) stays in the logs. */
  reason: string;
}

export function importFailureOf(error: unknown): ImportFailure {
  if (error instanceof PolygonImportError)
    return {
      code: error.code,
      params: error.params,
      message: error.message.slice(0, MAX_RECORDED_ERROR),
      reason: POLYGON_ERROR_PREFIX + error.message,
    };
  return {
    code: 'import_failed',
    params: {},
    message: GENERIC_FAILURE,
    reason: error instanceof Error ? error.message : String(error),
  };
}
