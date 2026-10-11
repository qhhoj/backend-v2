import { POLYGON_PACKAGE_TYPES } from '@libs/database';
import type { PolygonPackageType } from '@libs/database';
import { PACKAGE_STATES } from '@libs/problems';
import type { PackageState } from '@libs/problems';
import { ApiProperty } from '@nestjs/swagger';

/** The newest package of a Polygon problem; `id` and `revision` are null when it has none (`state` NONE). */
export class PolygonLatestPackageResponse {
  id!: number | null;
  revision!: number | null;
  @ApiProperty({ enum: PACKAGE_STATES, enumName: 'PolygonPackageState' })
  state!: PackageState;
  /** `full`: every test with its answer is in the package; `standard`: the tests are generated on a judge during the import. Null unless READY. */
  @ApiProperty({
    enum: POLYGON_PACKAGE_TYPES,
    enumName: 'PolygonPackageType',
    nullable: true,
  })
  type!: PolygonPackageType | null;
  /** When Polygon started building it; null without a package. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  createdAt!: string | null;
}

/** A pasted link that passed every check: shared with the account, token verified, not linked, a package READY. */
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
  /** The newest package, READY (full, or standard with generated tests): the one an import takes. */
  latestPackage!: PolygonLatestPackageResponse;
}
