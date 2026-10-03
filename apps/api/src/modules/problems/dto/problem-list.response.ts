import { uuidStr } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ProblemGroupsQuerier } from '../problem-groups.querier';
import { ProblemTypesQuerier } from '../problem-types.querier';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '../statement';
import { CatalogItemResponse } from './problem-meta.response';

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

  static from(
    problem: ProblemDocument,
    lang: StatementLanguage,
    types: ProblemTypesQuerier,
    groups: ProblemGroupsQuerier,
  ): ProblemListItemResponse {
    const group = groups.byId(uuidStr(problem.groupId));
    const { solution } = problem;
    return {
      id: problem._id,
      code: problem.code,
      name: statementFor(problem, lang).name,
      group: group && CatalogItemResponse.from(group),
      types: types
        .byIds(problem.typeIds.map(uuidStr))
        .map(CatalogItemResponse.from),
      points: problem.points,
      partial: problem.partial,
      userCount: problem.userCount,
      acRate: problem.acRate,
      date: problem.date?.toISOString() ?? null,
      isPublic: problem.isPublic,
      isOrganizationPrivate: problem.isOrganizationPrivate,
      hasPublicEditorial:
        solution !== null &&
        solution.isPublic &&
        solution.publishOn <= new Date(),
      hasPdfStatement: problem.pdfStatementUrl !== null,
    };
  }
}
