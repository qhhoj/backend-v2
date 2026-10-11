import { POLYGON_SYNC_STEPS } from '@libs/database';
import type { PolygonSyncStep } from '@libs/database';
import { IMPORT_STEPS } from '@libs/problems';
import type { ImportStep } from '@libs/problems';
import { ApiProperty } from '@nestjs/swagger';

/** The imported problem, once the job completed. */
export class ImportResultResponse {
  /** Id of the created or updated problem. */
  problemId!: string;
  /** Its code. */
  code!: string;
}

/** Where a running job is; `done`/`total` count downloaded bytes while `downloading` (`total` null when Polygon sent no size) and are null for the other steps. */
export class ImportProgressResponse {
  @ApiProperty({ enum: ['downloading', 'statements', 'tests'] })
  step!: 'downloading' | 'statements' | 'tests';
  done!: number | null;
  total!: number | null;
}

export class ImportJobResponse {
  /** Job id. */
  id!: string;
  /** BullMQ state: waiting | active | completed | failed | delayed | prioritized. */
  state!: string;
  /** Step for a progress display: queued, then downloading (Polygon imports only), statements, tests, and done or failed. */
  @ApiProperty({ enum: IMPORT_STEPS })
  step!: ImportStep;
  /** Progress of the running step; null while queued and once finished. */
  progress!: ImportProgressResponse | null;
  /** The imported problem; null until the job completes. */
  result!: ImportResultResponse | null;
  /** Only an import error written for the requester; any other failure is "Import failed". */
  error!: string | null;
  /** Where a failed job stopped: `checking` (before any work), a progress step, `saving` (the database write) or `finishing` (data files after the write); null unless failed, and for jobs that failed before it was recorded. */
  @ApiProperty({
    enum: POLYGON_SYNC_STEPS,
    enumName: 'PolygonSyncStep',
    nullable: true,
  })
  failedStep!: PolygonSyncStep | null;
}
