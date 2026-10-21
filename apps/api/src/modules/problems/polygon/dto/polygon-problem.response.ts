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

/** One statement of the Polygon problem: the language names an import's language options take. */
export class PolygonStatementLanguageResponse {
  /** Polygon's language name, such as `vietnamese` or `english`. */
  language!: string;
  /** The statement's title in that language; null when unnamed. */
  title!: string | null;
  /** It has a tutorial, which an import can take as the editorial. */
  hasTutorial!: boolean;
}

/** A pasted link that passed every check: shared with the account, token verified, not linked, a package READY. */
export class PolygonProblemResponse {
  /** Polygon problem id. */
  id!: number;
  /** Polygon short name. */
  name!: string;
  /** Statement name (Vietnamese, else English, else any language); null when no statement is named. */
  title!: string | null;
  /** Every statement language, sorted by name: with two or more, an import names the main one and maps or skips the others (`statementLanguages`); with two or more tutorials it names `tutorialLanguage`. */
  statements!: PolygonStatementLanguageResponse[];
  owner!: string;
  /** Current revision of the problem on Polygon. */
  revision!: number;
  /** The working copy has uncommitted changes. */
  modified!: boolean;
  /** The newest package, READY (full, or standard with generated tests): the one an import takes. */
  latestPackage!: PolygonLatestPackageResponse;
}
