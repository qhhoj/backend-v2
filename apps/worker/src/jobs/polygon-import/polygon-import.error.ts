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

/** An automatic sync reached a problem a contest is running with: the job waits until `until` (the contest's end) and runs again, recording nothing. */
export class SyncDeferredError extends Error {
  constructor(readonly until: Date) {
    super(`a contest using the problem runs until ${until.toISOString()}`);
    this.name = 'SyncDeferredError';
  }
}
