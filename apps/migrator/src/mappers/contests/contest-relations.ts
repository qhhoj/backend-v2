import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx } from '../../mapper';
import { importedProblem } from '../imported-rows';
import { tagSlug } from './contest-tags';

/** [field, M2M table, target column, id-map table]. */
const LINKS = [
  ['authors', 'judge_contest_authors', 'profile_id', 'judge_profile'],
  ['curators', 'judge_contest_curators', 'profile_id', 'judge_profile'],
  ['testers', 'judge_contest_testers', 'profile_id', 'judge_profile'],
  [
    'privateContestants',
    'judge_contest_private_contestants',
    'profile_id',
    'judge_profile',
  ],
  [
    'organizations',
    'judge_contest_organizations',
    'organization_id',
    'judge_organization',
  ],
  ['bannedUsers', 'judge_contest_banned_users', 'profile_id', 'judge_profile'],
  ['rateExclude', 'judge_contest_rate_exclude', 'profile_id', 'judge_profile'],
  [
    'viewContestScoreboard',
    'judge_contest_view_contest_scoreboard',
    'profile_id',
    'judge_profile',
  ],
] as const;

interface Entry {
  contest_id: number;
  problem_id: number;
  points: number;
  partial: number;
  is_pretested: number;
  output_prefix_override: number | null;
  max_submissions: number | null;
}

interface NamedLink {
  contest_id: number;
  name: string;
}

const PROBLEMS_SQL = `SELECT cp.contest_id, cp.problem_id, cp.points, cp.partial, cp.is_pretested, cp.output_prefix_override, cp.max_submissions
  FROM judge_contestproblem cp JOIN judge_problem p ON p.id = cp.problem_id ${importedProblem('p')}
  ORDER BY cp.contest_id, cp.\`order\`, cp.id`;
const JUDGES_SQL =
  'SELECT b.contest_id, j.name FROM judge_contest_banned_judges b JOIN judge_judge j ON j.id = b.judge_id ORDER BY b.id';
const TAGS_SQL =
  'SELECT ct.contest_id, t.name FROM judge_contest_tags ct JOIN judge_contesttag t ON t.id = ct.contesttag_id ORDER BY ct.id';

/** The contest's M2M links, banned judge names, tags and embedded problems, loaded once per run. */
export class ContestRelations {
  private readonly links = new Map<string, Map<number, number[]>>();
  private judges = new Map<number, string[]>();
  private tags = new Map<number, string[]>();
  private problems = new Map<number, Entry[]>();

  async load(source: LegacySourceService): Promise<void> {
    for (const [field, table, column] of LINKS)
      this.links.set(
        field,
        groupBy(
          await source.query<Record<string, number>>(
            `SELECT contest_id, \`${column}\` AS target FROM \`${table}\` ORDER BY id`,
          ),
          'contest_id',
          (row) => row.target,
        ),
      );
    const name = (row: NamedLink) => row.name;
    this.judges = groupBy(
      await source.query<NamedLink>(JUDGES_SQL),
      'contest_id',
      name,
    );
    this.tags = groupBy(
      await source.query<NamedLink>(TAGS_SQL),
      'contest_id',
      name,
    );
    this.problems = groupBy(
      await source.query<Entry>(PROBLEMS_SQL),
      'contest_id',
      (row) => row,
    );
  }

  fieldsOf(contestId: number, ctx: MapCtx) {
    const fields: Record<string, unknown> = {};
    for (const [field, , , target] of LINKS)
      fields[field] = (this.links.get(field)!.get(contestId) ?? [])
        .map((id) => ctx.refOrNull(target, id))
        .filter((id) => id !== null);
    fields.bannedJudges = this.judges.get(contestId) ?? [];
    fields.tags = this.tagsOf(contestId, ctx);
    fields.problems = this.problemsOf(contestId, ctx);
    return fields;
  }

  private tagsOf(contestId: number, ctx: MapCtx): string[] {
    const slugs = (this.tags.get(contestId) ?? []).map((name) => tagSlug(name));
    if (slugs.includes(null))
      ctx.report(`judge_contest:${contestId} empty tag dropped`);
    return [...new Set(slugs.filter((slug): slug is string => slug !== null))];
  }

  private problemsOf(contestId: number, ctx: MapCtx) {
    const seen = new Set<number>();
    const unique = (this.problems.get(contestId) ?? []).filter((entry) => {
      const repeated = seen.has(entry.problem_id);
      if (repeated)
        ctx.report(`judge_contest:${contestId} repeated problem dropped`);
      seen.add(entry.problem_id);
      return !repeated;
    });
    return unique.map((entry, order) => ({
      problem: ctx.ref('judge_problem', entry.problem_id)!,
      points: Number(entry.points),
      partial: ctx.bool(entry.partial),
      isPretested: ctx.bool(entry.is_pretested),
      order,
      outputPrefixOverride: entry.output_prefix_override,
      maxSubmissions:
        entry.max_submissions && entry.max_submissions > 0
          ? entry.max_submissions
          : null,
    }));
  }
}

export const CONTEST_RELATION_TABLES = [
  'judge_profile',
  'judge_organization',
  'judge_problem',
];
