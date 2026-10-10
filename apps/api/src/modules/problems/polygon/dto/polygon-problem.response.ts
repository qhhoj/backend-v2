import { PACKAGE_STATES } from '@libs/problems';
import type { PackageState } from '@libs/problems';
import { ApiProperty } from '@nestjs/swagger';

/** The newest package of a Polygon problem; `id` and `revision` are null when it has none (`state` NONE). */
export class PolygonLatestPackageResponse {
  id!: number | null;
  revision!: number | null;
  @ApiProperty({ enum: PACKAGE_STATES, enumName: 'PolygonPackageState' })
  state!: PackageState;
}

export class PolygonProblemResponse {
  /** Polygon problem id. */
  id!: number;
  /** Polygon short name. */
  name!: string;
  /** Statement name (Vietnamese, else English, else any language); null when no statement is named. */
  title!: string | null;
  owner!: string;
  /** Current revision of the problem on Polygon. */
  revision!: number;
  /** The working copy has uncommitted changes. */
  modified!: boolean;
  latestPackage!: PolygonLatestPackageResponse;
  /** Code of the QHHOJ problem already linked to it, or null. */
  linkedProblemCode!: string | null;
}
