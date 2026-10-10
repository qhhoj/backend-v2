import type { ProblemSolution, StatementLanguage } from '@libs/database';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '@libs/problems';
import { ProblemRefResponse } from './problem-ref.response';
import { UserSummaryResponse } from './user-summary.response';

export class EditorialResponse {
  /** The problem the editorial belongs to. */
  problem!: ProblemRefResponse;
  /** Whether the editorial is marked public. */
  isPublic!: boolean;
  /** When it becomes readable by everyone (ISO 8601). */
  publishOn!: string;
  /** Authors of the editorial. */
  authors!: UserSummaryResponse[];
  /** Rendered, sanitized HTML. */
  contentHtml!: string;
  /** Whether the viewer can edit the problem. */
  canEdit!: boolean;

  static from(
    problem: ProblemDocument,
    solution: ProblemSolution,
    view: {
      lang: StatementLanguage;
      authors: UserSummaryResponse[];
      canEdit: boolean;
    },
  ): EditorialResponse {
    const { lang, authors, canEdit } = view;
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
