import {
  POLYGON_PACKAGE_TYPES,
  POLYGON_SYNC_PURPOSES,
  POLYGON_SYNC_RESULTS,
  POLYGON_SYNC_STEPS,
  POLYGON_SYNC_TRIGGERS,
} from '@libs/database';
import type {
  PolygonPackageType,
  PolygonSyncPurpose,
  PolygonSyncResult,
  PolygonSyncStep,
  PolygonSyncTrigger,
} from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';
import { UserSummaryResponse } from '../../core/dto/user-summary.response';

/** One finished Polygon import or sync job. */
export class PolygonSyncRunResponse {
  /** Run id. */
  id!: string;
  /** Id of the QHHOJ problem; null when a first import failed before creating it. */
  problemId!: string | null;
  /** Code the job imported into. */
  code!: string;
  /** Polygon problem id. */
  polygonProblemId!: number;
  /** Polygon short name. */
  polygonName!: string;
  revision!: number;
  packageId!: number;
  /** Polygon's build time of the package; null for jobs queued before it was recorded. */
  packageCreatedAt!: Date | null;
  /** The package variant taken: `full`, or `standard` (tests generated on a judge). */
  @ApiProperty({ enum: POLYGON_PACKAGE_TYPES, enumName: 'PolygonPackageType' })
  packageType!: PolygonPackageType;
  @ApiProperty({ enum: POLYGON_SYNC_PURPOSES, enumName: 'PolygonSyncPurpose' })
  purpose!: PolygonSyncPurpose;
  @ApiProperty({ enum: POLYGON_SYNC_TRIGGERS, enumName: 'PolygonSyncTrigger' })
  trigger!: PolygonSyncTrigger;
  /** Who started it (the linking user for an automatic sync); null when the account is gone. */
  requestedBy!: UserSummaryResponse | null;
  @ApiProperty({ enum: POLYGON_SYNC_RESULTS, enumName: 'PolygonSyncResult' })
  result!: PolygonSyncResult;
  @ApiProperty({
    enum: POLYGON_SYNC_STEPS,
    enumName: 'PolygonSyncStep',
    nullable: true,
  })
  failedStep!: PolygonSyncStep | null;
  /** Why it failed, as shown to the requester; null when it succeeded. */
  error!: string | null;
  /** When the job ended. */
  finishedAt!: Date;
}
