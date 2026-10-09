import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { uuidStr } from '@libs/database';
import { Document } from 'mongodb';
import { Connection } from 'mongoose';
import { IdMapRepository } from './id-map.repository';
import { LegacySourceService } from './legacy-source.service';
import { importedParticipation } from './mappers/imported-rows';

/** Legacy-rated participations the participations job imports: the replay must rate each (user ruling). */
const LEGACY_RATED_SQL = `SELECT r.participation_id AS id, r.contest_id FROM judge_rating r
  JOIN judge_contestparticipation p ON p.id = r.participation_id ${importedParticipation('p')}`;

/** Rows of `collection` whose `field` names no `_id` of `foreign` . */
interface Reference {
  what: string;
  collection: string;
  field: string;
  foreign: string;
  /** The array that holds `field` (one row per element). */
  array?: string;
  /** Only rows matching this are checked. */
  where?: Document;
}

const REFERENCES: readonly Reference[] = [
  {
    what: 'submissions without a source',
    collection: 'submissions',
    field: '_id',
    foreign: 'submissionSources',
  },
  {
    what: 'submissionSources without a submission',
    collection: 'submissionSources',
    field: '_id',
    foreign: 'submissions',
  },
  {
    what: 'contestSubmissions whose submission is missing',
    collection: 'contestSubmissions',
    field: '_id',
    foreign: 'submissions',
  },
  {
    what: 'contestSubmissions whose participation is missing',
    collection: 'contestSubmissions',
    field: 'participation',
    foreign: 'contestParticipations',
  },
  {
    what: 'contestParticipations whose contest is missing',
    collection: 'contestParticipations',
    field: 'contest',
    foreign: 'contests',
  },
  {
    what: 'contestParticipations whose user is missing',
    collection: 'contestParticipations',
    field: 'user',
    foreign: 'users',
  },
  {
    what: 'contest problems that are missing',
    collection: 'contests',
    field: 'problems.problem',
    foreign: 'problems',
    array: 'problems',
  },
  {
    what: 'comments whose thread root is missing',
    collection: 'comments',
    field: 'threadId',
    foreign: 'comments',
  },
  {
    what: 'comments whose parent is missing',
    collection: 'comments',
    field: 'parentId',
    foreign: 'comments',
  },
  {
    what: 'tickets whose linked problem is missing',
    collection: 'tickets',
    field: 'linkedItem.id',
    foreign: 'problems',
    where: { 'linkedItem.type': 'problem' },
  },
  {
    what: 'tickets whose linked general issue is missing',
    collection: 'tickets',
    field: 'linkedItem.id',
    foreign: 'generalIssues',
    where: { 'linkedItem.type': 'general' },
  },
  {
    what: 'ratings whose participation is missing',
    collection: 'ratings',
    field: 'participation',
    foreign: 'contestParticipations',
  },
  {
    what: 'ratings whose user is missing',
    collection: 'ratings',
    field: 'user',
    foreign: 'users',
  },
  {
    what: 'commentVotes whose comment is missing',
    collection: 'commentVotes',
    field: 'comment',
    foreign: 'comments',
  },
  {
    what: 'blogVotes whose post is missing',
    collection: 'blogVotes',
    field: 'blog',
    foreign: 'blogPosts',
  },
];

const lookup = (from: string, field: string, as: string): Document => ({
  $lookup: { from, localField: field, foreignField: '_id', as },
});

const danglingPipeline = (ref: Reference): Document[] => [
  ...(ref.array ? [{ $unwind: `$${ref.array}` }] : []),
  { $match: { ...ref.where, [ref.field]: { $ne: null } } },
  lookup(ref.foreign, ref.field, 'target'),
  { $match: { target: { $size: 0 } } },
  { $count: 'total' },
];

/** Graded submissions that score above their problem's points: a copied legacy score that was never rescaled. */
const OVERSCORED: Document[] = [
  { $match: { points: { $ne: null } } },
  lookup('problems', 'problem', 'target'),
  { $unwind: '$target' },
  { $match: { $expr: { $gt: ['$points', '$target.points'] } } },
  { $count: 'total' },
];

const BREAKDOWN_SHOWN = 10;

/** The total, then the legacy contests that lose the most rows, so the exit 1 can be triaged without reading data. */
const missingLines = (byContest: Map<number, number>): string[] => {
  const total = [...byContest.values()].reduce((sum, rows) => sum + rows, 0);
  if (!total) return [];
  const worst = [...byContest]
    .sort(([, left], [, right]) => right - left)
    .slice(0, BREAKDOWN_SHOWN)
    .map(([contest, rows]) => `  judge_contest:${contest}: ${rows}`);
  return [
    `legacy-rated participations without a v2 rating: ${total}`,
    ...worst,
  ];
};

/** Cross-collection invariants `verify` (row by row) cannot see; run after `recompute`. */
@Injectable()
export class IntegrityCheckService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly source: LegacySourceService,
    private readonly ids: IdMapRepository,
  ) {}

  async run(): Promise<string[]> {
    const lines: string[] = [];
    for (const ref of REFERENCES) {
      const count = await this.count(ref.collection, danglingPipeline(ref));
      if (count) lines.push(`${ref.what}: ${count}`);
    }
    const overscored = await this.count('submissions', OVERSCORED);
    if (overscored)
      lines.push(
        `submissions scoring above their problem's points: ${overscored}`,
      );
    const stale = await this.staleRatings();
    if (stale)
      lines.push(
        `users whose rating differs from their newest rating row: ${stale}`,
      );
    return [...lines, ...(await this.ratingCoverage())];
  }

  /** User ruling: every legacy-rated participation has a v2 rating row; the rated-contest counts match. */
  private async ratingCoverage(): Promise<string[]> {
    const legacy = await this.source.query<{ id: number; contest_id: number }>(
      LEGACY_RATED_SQL,
    );
    await this.ids.load(['judge_contestparticipation']);
    const ratings = this.conn.collection('ratings');
    const rated = new Set(
      (await ratings.distinct('participation')).map(uuidStr),
    );
    const legacyIds = new Set<string>();
    const missingByContest = new Map<number, number>();
    for (const row of legacy) {
      const id = this.ids.find('judge_contestparticipation', Number(row.id));
      if (id) legacyIds.add(id);
      if (id && rated.has(id)) continue;
      const contest = Number(row.contest_id);
      missingByContest.set(contest, (missingByContest.get(contest) ?? 0) + 1);
    }
    const legacyContests = new Set(legacy.map((row) => Number(row.contest_id)))
      .size;
    const v2Contests = (await ratings.distinct('contest')).length;
    const extra = [...rated].filter((id) => !legacyIds.has(id)).length;
    return [
      ...missingLines(missingByContest),
      ...(legacyContests === v2Contests
        ? []
        : [`rated contests: legacy ${legacyContests}, v2 ${v2Contests}`]),
      ...(extra ? [`v2 ratings without a legacy rating: ${extra}`] : []),
    ];
  }

  private async count(
    collection: string,
    pipeline: Document[],
  ): Promise<number> {
    const [result] = await this.conn
      .collection(collection)
      .aggregate(pipeline)
      .toArray();
    return (result?.total as number | undefined) ?? 0;
  }

  /** `users.rating` must equal the newest rating row, in the order `ContestRatingRepository` uses. */
  private staleRatings(): Promise<number> {
    return this.count('users', [
      {
        $lookup: {
          from: 'ratings',
          localField: '_id',
          foreignField: 'user',
          as: 'history',
          pipeline: [
            { $sort: { contestEndTime: -1, contest: -1 } },
            { $limit: 1 },
          ],
        },
      },
      {
        $match: {
          $expr: {
            $ne: [
              { $ifNull: ['$rating', null] },
              { $ifNull: [{ $first: '$history.rating' }, null] },
            ],
          },
        },
      },
      { $count: 'total' },
    ]);
  }
}
