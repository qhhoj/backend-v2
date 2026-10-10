import type { CommentPageType } from '@libs/database';
import { LegacySourceService } from '../../legacy-source.service';
import { importedProblem } from '../imported-rows';

export interface PageTarget {
  type: CommentPageType;
  /** The id-map table of the target. */
  table: string;
  id: number;
}

const byKey = (rows: { id: number; key: string }[]) =>
  new Map(rows.map((row) => [row.key, row.id]));

/** Every table a comment page or lock can point at; the id map must cover them. */
export const PAGE_TABLES = [
  'judge_problem',
  'judge_contest',
  'judge_tagproblem',
];

/** Legacy comment page strings (`p:`, `s:`, `c:`, `t:` plus a natural key) resolved to imported entities. */
export class CommentPages {
  private problems = new Map<string, number>();
  private contests = new Map<string, number>();
  private tagProblems = new Map<string, number>();

  async load(source: LegacySourceService): Promise<void> {
    this.problems = byKey(
      await source.query(
        `SELECT p.id, p.code AS \`key\` FROM judge_problem p ${importedProblem('p')}`,
      ),
    );
    this.contests = byKey(
      await source.query('SELECT id, `key` FROM judge_contest'),
    );
    this.tagProblems = byKey(
      await source.query('SELECT id, code AS `key` FROM judge_tagproblem'),
    );
  }

  resolve(page: string): PageTarget | null {
    const key = page.slice(2);
    switch (page.slice(0, 2)) {
      case 'p:':
        return this.target('problem', 'judge_problem', this.problems.get(key));
      case 's:':
        return this.target(
          'editorial',
          'judge_problem',
          this.problems.get(key),
        );
      case 'c:':
        return this.target('contest', 'judge_contest', this.contests.get(key));
      case 't:':
        return this.target(
          'tagProblem',
          'judge_tagproblem',
          this.tagProblems.get(key),
        );
      default:
        return null;
    }
  }

  /** The legacy blog (`b:<id>`) is not migrated by decision; its pages never resolve. */
  isBlog(page: string): boolean {
    return page.startsWith('b:');
  }

  private target(
    type: CommentPageType,
    table: string,
    id: number | undefined,
  ): PageTarget | null {
    return id === undefined ? null : { type, table, id };
  }
}
