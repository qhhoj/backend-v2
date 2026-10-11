import { POLYGON_SYNC_RESULTS } from '@libs/database';
import type { PolygonSyncResult } from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';
import { PolygonLatestPackageResponse } from './polygon-problem.response';

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
  autoSync!: boolean;
}

export class PolygonLinkStateResponse {
  link!: PolygonLinkResponse;
  /** The newest package on Polygon now; null when Polygon could not be asked (not connected, unreachable, access revoked). */
  latestPackage!: PolygonLatestPackageResponse | null;
}
