import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx } from '../../mapper';

/** [field, M2M table, target column, id-map table of the target]. */
const LINKS = [
  ['typeIds', 'judge_problem_types', 'problemtype_id', 'judge_problemtype'],
  ['authors', 'judge_problem_authors', 'profile_id', 'judge_profile'],
  ['curators', 'judge_problem_curators', 'profile_id', 'judge_profile'],
  ['testers', 'judge_problem_testers', 'profile_id', 'judge_profile'],
  ['bannedUsers', 'judge_problem_banned_users', 'profile_id', 'judge_profile'],
  [
    'organizations',
    'judge_problem_organizations',
    'organization_id',
    'judge_organization',
  ],
  [
    'allowedLanguages',
    'judge_problem_allowed_languages',
    'language_id',
    'judge_language',
  ],
] as const;

type Limit = {
  problem_id: number;
  language_id: number;
  time_limit: number;
  memory_limit: number;
};

export class ProblemRelations {
  private readonly links = new Map<string, Map<number, number[]>>();
  private limits = new Map<number, Limit[]>();

  async load(source: LegacySourceService): Promise<void> {
    for (const [field, table, column] of LINKS)
      this.links.set(
        field,
        groupBy(
          await source.query<Record<string, number>>(
            `SELECT problem_id, \`${column}\` AS target FROM \`${table}\` ORDER BY id`,
          ),
          'problem_id',
          (row) => row.target,
        ),
      );
    this.limits = groupBy(
      await source.query<Limit>(
        'SELECT problem_id, language_id, time_limit, memory_limit FROM judge_languagelimit ORDER BY id',
      ),
      'problem_id',
      (row) => row,
    );
  }

  fieldsOf(problemId: number, ctx: MapCtx) {
    const fields: Record<string, unknown> = {};
    for (const [field, , , target] of LINKS)
      fields[field] = (this.links.get(field)!.get(problemId) ?? [])
        .map((id) => ctx.refOrNull(target, id))
        .filter((id) => id !== null);
    fields.languageLimits = (this.limits.get(problemId) ?? []).flatMap(
      (limit) => {
        const languageId = ctx.refOrNull('judge_language', limit.language_id);
        return languageId
          ? [
              {
                languageId,
                timeLimit: Number(limit.time_limit),
                memoryLimit: Number(limit.memory_limit),
              },
            ]
          : [];
      },
    );
    return fields;
  }
}

export const RELATION_TABLES = [
  'judge_problemtype',
  'judge_profile',
  'auth_user',
  'judge_organization',
  'judge_language',
];
