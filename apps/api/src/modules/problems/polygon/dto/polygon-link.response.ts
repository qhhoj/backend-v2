import { POLYGON_SYNC_RESULTS } from '@libs/database';
import type { PolygonSyncResult } from '@libs/database';
import type { ImportErrorParams, PolygonImportErrorCode } from '@libs/problems';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiImportErrorCode,
  ApiImportErrorParams,
} from '../../imports/dto/import-error.decorators';
import { PolygonLatestPackageResponse } from './polygon-problem.response';

/** The statement and test options every sync re-applies (`PATCH /problems/{code}/polygon` edits them). */
export class PolygonLinkOptionsResponse {
  mainStatementLanguage!: string | null;
  /** `<polygon language>=<en|vi|skip>`, sorted, in the form the import and the PATCH take. */
  statementLanguages!: string[];
  tutorialLanguage!: string | null;
  ignoreZeroPointBatches!: boolean;
  ignoreZeroPointCases!: boolean;
  appendMainSolution!: boolean;
  /** Whether the package statement's tutorial becomes the editorial. */
  importTutorial!: boolean;
  /** Testcase limit of the user who linked the problem; a sync of more tests fails with `too_many_testcases`. Not editable. */
  maxCases!: number;
}

export class PolygonLinkResponse {
  /** Polygon problem id. */
  problemId!: number;
  name!: string;
  owner!: string;
  /** Revision and package the problem's content was last taken from. */
  revision!: number;
  packageId!: number;
  /** Polygon's build time of that package; null for links made before it was recorded. */
  packageCreatedAt!: Date | null;
  /** Statement title taken from that package; null for links made before it was recorded. */
  title!: string | null;
  linkedAt!: Date;
  lastSyncAt!: Date | null;
  @ApiProperty({
    enum: POLYGON_SYNC_RESULTS,
    enumName: 'PolygonSyncResult',
    nullable: true,
  })
  lastSyncResult!: PolygonSyncResult | null;
  /** Why the last sync failed, as shown to the requester. */
  lastSyncError!: string | null;
  /** The last sync's failure as a code (`imported_needs_attention` when it imported but needs a repair); null after a success. */
  @ApiImportErrorCode()
  lastSyncErrorCode!: PolygonImportErrorCode | null;
  @ApiImportErrorParams()
  lastSyncErrorParams!: ImportErrorParams | null;
  autoSync!: boolean;
  options!: PolygonLinkOptionsResponse;
}

export class PolygonLinkStateResponse {
  link!: PolygonLinkResponse;
  /** The newest package on Polygon now; null when Polygon could not be asked (not connected, unreachable, access revoked). */
  latestPackage!: PolygonLatestPackageResponse | null;
  /** The queued or running sync (or update import) of the problem, to poll at `GET /problems/imports/{jobId}`; null when none. */
  runningJobId!: string | null;
}
