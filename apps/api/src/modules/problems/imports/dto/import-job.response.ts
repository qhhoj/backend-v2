import type { PolygonImportResult } from '@libs/problems';

export class ImportJobResponse {
  id!: string;
  /** BullMQ state: waiting | active | completed | failed | delayed | prioritized. */
  state!: string;
  result!: PolygonImportResult | null;
  /** Only an import error written for the requester; any other failure is "Import failed". */
  error!: string | null;
}
