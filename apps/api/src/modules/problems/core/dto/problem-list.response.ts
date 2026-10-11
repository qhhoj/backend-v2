import { uuidStr } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ProblemGroupsQuerier } from '../../catalog/problem-groups.querier';
import { ProblemTypesQuerier } from '../../catalog/problem-types.querier';
import { isEditorialPublished } from '../problem-search';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '@libs/problems';
import { CatalogItemResponse } from './problem-meta.response';
import { ApiProperty } from '@nestjs/swagger';
import { VIEWER_MARKS, type ViewerStatus } from '../viewer-status.repository';
import { UserSummaryResponse } from './user-summary.response';

export class ProblemListItemResponse {
  /** Problem id. */
  id!: string;
  /** Problem code, unique and used in URLs. */
  code!: string;
  /** Title in the requested language, or the base language when untranslated. */
  name!: string;
  /** Problem group; null when none. */
  group!: CatalogItemResponse | null;
  /** Problem types. */
  types!: CatalogItemResponse[];
  /** Points the problem is worth. */
  points!: number;
  /** Whether partial scores are given. */
  partial!: boolean;
  /** Number of users who solved the problem. */
  userCount!: number;
  /** Percentage of accepted submissions, 0 to 100. */
  acRate!: number;
  /** Publication date (ISO 8601); null when unset. */
  date!: string | null;
  /** Whether the problem is public. */
  isPublic!: boolean;
  /** Whether only members of the listed organizations can see it. */
  isOrganizationPrivate!: boolean;
  /** Whether an editorial is published. */
  hasPublicEditorial!: boolean;
  /** Whether a PDF statement was uploaded. */
  hasPdfStatement!: boolean;
  /** Credited authors, in stored order; deleted accounts are left out. */
  authors!: UserSummaryResponse[];
  /** For the signed-in viewer; null when anonymous or never submitted. */
  @ApiProperty({ enum: VIEWER_MARKS, nullable: true })
  viewerStatus!: ViewerStatus;

  static from(
    problem: ProblemDocument,
    catalog: {
      lang: StatementLanguage;
      types: ProblemTypesQuerier;
      groups: ProblemGroupsQuerier;
    },
    viewerStatus: ViewerStatus,
    authors: UserSummaryResponse[],
  ): ProblemListItemResponse {
    const { lang, types, groups } = catalog;
    const group = groups.byId(uuidStr(problem.groupId));
    return {
      id: problem._id,
      code: problem.code,
      name: statementFor(problem, lang).name,
      group: group && CatalogItemResponse.from(group),
      types: types
        .byIds(problem.typeIds.map(uuidStr))
        .map((item) => CatalogItemResponse.from(item)),
      points: problem.points,
      partial: problem.partial,
      userCount: problem.userCount,
      acRate: problem.acRate,
      date: problem.date?.toISOString() ?? null,
      isPublic: problem.isPublic,
      isOrganizationPrivate: problem.isOrganizationPrivate,
      hasPublicEditorial: isEditorialPublished(problem.solution),
      hasPdfStatement: problem.pdfStatementUrl !== null,
      authors,
      viewerStatus,
    };
  }
}

export class RandomProblemResponse {
  /** Code of the picked problem. */
  code!: string;
}
