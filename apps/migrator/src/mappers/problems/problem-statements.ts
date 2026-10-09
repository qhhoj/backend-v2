import { STATEMENT_LANGUAGES } from '@libs/database';
import type { RenderStyle } from '@libs/render';
import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx } from '../../mapper';

type Translation = {
  problem_id: number;
  language: string;
  name: string;
  description: string;
};
type Solution = {
  id: number;
  problem_id: number;
  is_public: number;
  publish_on: Date | null;
  content: string;
};

export class ProblemStatements {
  private translations = new Map<number, Translation[]>();
  private solutions = new Map<number, Solution[]>();
  private solutionAuthors = new Map<number, number[]>();

  async load(source: LegacySourceService): Promise<void> {
    this.translations = groupBy(
      await source.query<Translation>(
        'SELECT problem_id, language, name, description FROM judge_problemtranslation ORDER BY id',
      ),
      'problem_id',
      (row) => row,
    );
    this.solutions = groupBy(
      await source.query<Solution>(
        'SELECT id, problem_id, is_public, publish_on, content FROM judge_solution ORDER BY id',
      ),
      'problem_id',
      (row) => row,
    );
    this.solutionAuthors = groupBy(
      await source.query<{ solution_id: number; profile_id: number }>(
        'SELECT solution_id, profile_id FROM judge_solution_authors ORDER BY id',
      ),
      'solution_id',
      (row) => row.profile_id,
    );
  }

  translationsOf(problemId: number, style: RenderStyle, ctx: MapCtx) {
    return (this.translations.get(problemId) ?? []).flatMap((row) => {
      if (!(STATEMENT_LANGUAGES as readonly string[]).includes(row.language)) {
        ctx.report(
          `dropped translation ${row.language} of judge_problem:${problemId}`,
        );
        return [];
      }
      const where = `judge_problemtranslation of judge_problem:${problemId}`;
      return [
        {
          language: row.language,
          name: row.name,
          description: row.description ?? '',
          descriptionHtml: ctx.render(row.description, style, where),
        },
      ];
    });
  }

  solutionOf(problemId: number, ctx: MapCtx) {
    const row = this.solutions.get(problemId)?.[0];
    if (!row) return null;
    const publishOn = ctx.date(row.publish_on);
    if (!publishOn) {
      ctx.report(`dropped judge_solution:${row.id} (no publish date)`);
      return null;
    }
    return {
      isPublic: ctx.bool(row.is_public),
      publishOn,
      authors: (this.solutionAuthors.get(row.id) ?? [])
        .map((id) => ctx.refOrNull('judge_profile', id))
        .filter((id) => id !== null),
      content: row.content ?? '',
      contentHtml: ctx.render(
        row.content,
        'solution',
        `judge_solution:${row.id}`,
      ),
    };
  }
}
