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

/** Rows of `collection` whose `field` names no `_id` of `foreign` (nor of `orForeign`). */
interface Reference {
  what: string;
  collection: string;
  field: string;
  foreign: string;
  /** The array that holds `field` (one row per element). */
  array?: string;
  orForeign?: string;
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
    what: 'tickets whose linked item is missing',
    collection: 'tickets',
    field: 'linkedItem.id',
    foreign: 'problems',
    orForeign: 'generalIssues',
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
  { $match: { [ref.field]: { $ne: null } } },
  lookup(ref.foreign, ref.field, 'target'),
  ...(ref.orForeign
    ? [
        lookup(ref.orForeign, ref.field, 'other'),
        { $match: { other: { $size: 0 } } },
      ]
    : []),
  { $match: { target: { $size: 0 } } },
  { $count: 'total' },
];

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
    const missing = legacy.filter((row) => {
      const id = this.ids.find('judge_contestparticipation', Number(row.id));
      return !id || !rated.has(id);
    }).length;
    const legacyContests = new Set(legacy.map((row) => Number(row.contest_id)))
      .size;
    const v2Contests = (await ratings.distinct('contest')).length;
    const lines = missing
      ? [`legacy-rated participations without a v2 rating: ${missing}`]
      : [];
    return legacyContests === v2Contests
      ? lines
      : [
          ...lines,
          `rated contests: legacy ${legacyContests}, v2 ${v2Contests}`,
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
