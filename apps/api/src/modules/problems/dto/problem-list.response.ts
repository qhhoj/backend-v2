import { uuidStr } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ProblemGroupsQuerier } from '../problem-groups.querier';
import { ProblemTypesQuerier } from '../problem-types.querier';
import { isEditorialPublished } from '../problem-search';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '@libs/problems';
import { CatalogItemResponse } from './problem-meta.response';
import type { ViewerStatus } from '../viewer-status.repository';

export class ProblemListItemResponse {
  id!: string;
  code!: string;
  name!: string;
  group!: CatalogItemResponse | null;
  types!: CatalogItemResponse[];
  points!: number;
  partial!: boolean;
  userCount!: number;
  acRate!: number;
  date!: string | null;
  isPublic!: boolean;
  isOrganizationPrivate!: boolean;
  hasPublicEditorial!: boolean;
  hasPdfStatement!: boolean;
  /** For the signed-in viewer; null when anonymous or never submitted. */
  viewerStatus!: ViewerStatus;

  static from(
    problem: ProblemDocument,
    lang: StatementLanguage,
    types: ProblemTypesQuerier,
    groups: ProblemGroupsQuerier,
    viewerStatus: ViewerStatus,
  ): ProblemListItemResponse {
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
      viewerStatus,
    };
  }
}
