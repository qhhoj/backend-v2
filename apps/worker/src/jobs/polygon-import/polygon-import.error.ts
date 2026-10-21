import type { ImportErrorParams, PolygonImportErrorCode } from '@libs/problems';

/** Why an import stopped; stored as the job's failure reason and shown to the requester, with a code the UI translates and the parameters its text needs. */
export class PolygonImportError extends Error {
  constructor(
    message: string,
    readonly code: PolygonImportErrorCode = 'package_invalid',
    readonly params: ImportErrorParams = {},
  ) {
    super(message);
    this.name = 'PolygonImportError';
  }
}
