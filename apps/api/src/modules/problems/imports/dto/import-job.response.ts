import {
  CHECKERS,
  POLYGON_SYNC_PURPOSES,
  POLYGON_SYNC_STEPS,
} from '@libs/database';
import type {
  Checker,
  PolygonSyncPurpose,
  PolygonSyncStep,
} from '@libs/database';
import { IMPORT_STEPS, POLYGON_IMPORT_ERROR_CODES } from '@libs/problems';
import type {
  ImportErrorParams,
  ImportStep,
  PolygonImportErrorCode,
} from '@libs/problems';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiImportErrorCode,
  ApiImportErrorParams,
} from './import-error.decorators';

/** A limit as Polygon gives it and as stored, clamped to the editor's range. */
export class ClampedLimitResponse {
  polygon!: number;
  applied!: number;
}

/** How the package was converted: what to check against Polygon before a contest. */
export class ImportSummaryResponse {
  /** The package's checker (`std::wcmp.cpp`, or a custom checker's source path); null for an interactive problem without one. */
  polygonChecker!: string | null;
  /** What judges answers: `standard` (hcmp) or `bridged` (the package's own testlib checker); an interactive problem's interactor decides alone. */
  @ApiProperty({ enum: CHECKERS, enumName: 'Checker' })
  checker!: Checker;
  interactive!: boolean;
  /** An interactive problem's checker that is not run. */
  checkerIgnored!: boolean;
  /** Distinct tests. */
  tests!: number;
  /** Judged cases, dependency copies counted. */
  cases!: number;
  batches!: number;
  /** Seconds. */
  timeLimit!: ClampedLimitResponse;
  /** KiB. */
  memoryLimit!: ClampedLimitResponse;
}

/** The import committed, then a file step failed: the problem exists and a sync (or a data upload) repairs it. */
export class ImportAttentionResponse {
  /** Always `imported_needs_attention`. */
  @ApiProperty({
    enum: POLYGON_IMPORT_ERROR_CODES,
    enumName: 'PolygonImportErrorCode',
  })
  code!: PolygonImportErrorCode;
  @ApiImportErrorParams()
  params!: ImportErrorParams;
  /** What failed, in English. */
  message!: string;
}

/** The imported problem, once the job completed. */
export class ImportResultResponse {
  /** Id of the created or updated problem. */
  problemId!: string;
  /** Its code. */
  code!: string;
  /** Null for jobs from before it was recorded and for a sync another sync had already applied. */
  summary!: ImportSummaryResponse | null;
  /** Set when the problem was imported but needs a repair. */
  attention!: ImportAttentionResponse | null;
}

/** Where a running job is; `done`/`total` count downloaded bytes while `downloading` (`total` null when Polygon sent no size) and are null for the other steps. */
export class ImportProgressResponse {
  @ApiProperty({
    enum: ['downloading', 'statements', 'generating', 'tests'],
  })
  step!: 'downloading' | 'statements' | 'generating' | 'tests';
  done!: number | null;
  total!: number | null;
}

export class ImportJobResponse {
  /** Job id. */
  id!: string;
  /** Code of the problem the job creates or updates. */
  code!: string;
  @ApiProperty({ enum: ['create', 'update'] })
  mode!: 'create' | 'update';
  /** `link` (a first import from a Polygon link), `sync`, or null for an uploaded package. */
  @ApiProperty({
    enum: POLYGON_SYNC_PURPOSES,
    enumName: 'PolygonSyncPurpose',
    nullable: true,
  })
  purpose!: PolygonSyncPurpose | null;
  /** BullMQ state: waiting | active | completed | failed | delayed (waiting for its retry) | prioritized (an automatic sync). */
  state!: string;
  /** Step for a progress display: queued, then downloading (Polygon imports only), statements, generating (the tests of a Polygon standard package, on a judge), tests, and done or failed. Only a running job shows a progress step. */
  @ApiProperty({ enum: IMPORT_STEPS })
  step!: ImportStep;
  /** Progress of the running step; null unless the job runs. */
  progress!: ImportProgressResponse | null;
  /** 1-based place in the queue while the job waits (1: next); null otherwise. */
  queuePosition!: number | null;
  /** The imported problem; null until the job completes. */
  result!: ImportResultResponse | null;
  /** Only an import error written for the requester; any other failure is "Import failed". Null unless failed. */
  error!: string | null;
  @ApiImportErrorCode()
  errorCode!: PolygonImportErrorCode | null;
  @ApiImportErrorParams()
  errorParams!: ImportErrorParams | null;
  /** The same request may pass later (Polygon or the judges were out, the problem changed meanwhile): offer "try again". False for failures the options or the package must fix. */
  retryable!: boolean;
  /** Where a failed job stopped: `checking` (before any work), a progress step, `saving` (the database write) or `finishing` (data files after the write); null unless failed, and for jobs that failed before it was recorded. */
  @ApiProperty({
    enum: POLYGON_SYNC_STEPS,
    enumName: 'PolygonSyncStep',
    nullable: true,
  })
  failedStep!: PolygonSyncStep | null;
  /** When it was queued. */
  createdAt!: Date;
  /** When it ended; null while queued or running. */
  finishedAt!: Date | null;
}
