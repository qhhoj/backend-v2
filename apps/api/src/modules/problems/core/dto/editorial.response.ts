import type { ProblemSolution, StatementLanguage } from '@libs/database';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '@libs/problems';
import { UserSummaryResponse } from './user-summary.response';

export class EditorialResponse {
  problem!: { code: string; name: string };
  isPublic!: boolean;
  publishOn!: string;
  authors!: UserSummaryResponse[];
  contentHtml!: string;
  canEdit!: boolean;

  static from(
    problem: ProblemDocument,
    solution: ProblemSolution,
    lang: StatementLanguage,
    authors: UserSummaryResponse[],
    canEdit: boolean,
  ): EditorialResponse {
    return {
      problem: { code: problem.code, name: statementFor(problem, lang).name },
      isPublic: solution.isPublic,
      publishOn: solution.publishOn.toISOString(),
      authors,
      contentHtml: solution.contentHtml,
      canEdit,
    };
  }
}
