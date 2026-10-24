import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Problem, Submission, toUuid, User, uuidStr } from '@libs/database';
import { ANY_SOLVED, gradedJobOf, SOLVED_FILTER } from '@libs/judging';
import type {
  ProblemBest,
  SubmissionGradedJob,
  UserPoints,
} from '@libs/judging';

export type EffectsProblem = Pick<
  Problem,
  | '_id'
  | 'points'
  | 'partial'
  | 'isPublic'
  | 'isOrganizationPrivate'
  | 'deletedAt'
>;

export type ProblemStats = Pick<Problem, 'userCount' | 'acRate'>;

/** Every Mongo read and write of the effects, the sweep and the rescore. Recomputes read, never increment. */
@Injectable()
export class SubmissionEffectsRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** Users and problems of submissions graded (`judgedDate`, set at grading-begin) or created (`date`: a compile error never reaches grading-begin) in the window; each branch has its own index. */
  async touchedBetween(
    from: Date,
    to: Date,
  ): Promise<{ userIds: string[]; problemIds: string[] }> {
    const window = { $gte: from, $lt: to };
    const filter = { $or: [{ judgedDate: window }, { date: window }] };
    const [users, problems] = await Promise.all([
      this.submissions.distinct('user', filter).exec(),
      this.submissions.distinct('problem', filter).exec(),
    ]);
    return {
      userIds: users.map(uuidStr),
      problemIds: problems.map(uuidStr),
    };
  }

  async effectsDueAt(submissionId: string): Promise<Date | null> {
    const row = await this.submissions
      .findById(submissionId, { effectsDueAt: 1 })
      .lean()
      .exec();
    return row?.effectsDueAt ?? null;
  }

  /** Clears the stamp `due` only: a newer finish wrote a newer one, which stays due. */
  async clearEffectsDue(submissionId: string, due: Date): Promise<void> {
    await this.submissions
      .updateOne(
        { _id: submissionId, effectsDueAt: due },
        { $set: { effectsDueAt: null } },
      )
      .exec();
  }

  /** A row whose repair failed goes to the back of the line (due from now), so failing rows cannot hold back the rest. */
  async postponeEffectsDue(submissionId: string): Promise<void> {
    await this.submissions
      .updateOne(
        { _id: submissionId, effectsDueAt: { $type: 'date' } },
        { $set: { effectsDueAt: new Date() } },
      )
      .exec();
  }

  /** The oldest rows whose effects have been due since before `before` (read through the partial `effectsDueAt` index), as graded jobs. */
  async effectsDueBefore(
    before: Date,
    limit: number,
  ): Promise<SubmissionGradedJob[]> {
    const rows = await this.submissions
      .find(
        { effectsDueAt: { $type: 'date', $lt: before } },
        { user: 1, problem: 1 },
      )
      .sort({ effectsDueAt: 1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map(gradedJobOf);
  }

  /** Deliberately S: it also answers for a deleted problem and returns `deletedAt`, so a grading that finishes after a delete is recognised and ignored (and `problem-rescore` still runs for it). */
  findProblem(problemId: string): Promise<EffectsProblem | null> {
    return this.problems
      .findById(problemId, {
        points: 1,
        partial: 1,
        isPublic: 1,
        isOrganizationPrivate: 1,
        deletedAt: 1,
      })
      .lean<EffectsProblem>()
      .exec();
  }

  /** Legacy `calculate_points` data: per public, non-organisation-private problem the user's best points and whether some submission solved it. Grouped per problem first, so 10k submissions become one row per problem before the problem lookup. */
  async problemBests(userId: string): Promise<ProblemBest[]> {
    const rows = await this.submissions.aggregate<{
      maxPoints: number;
      solved: number;
    }>([
      { $match: { user: toUuid(userId), points: { $ne: null } } },
      {
        $group: {
          _id: '$problem',
          maxPoints: { $max: '$points' },
          solved: ANY_SOLVED,
        },
      },
      {
        $lookup: {
          from: this.problems.collection.name,
          localField: '_id',
          foreignField: '_id',
          pipeline: [
            {
              $match: {
                isPublic: true,
                isOrganizationPrivate: false,
                deletedAt: null,
              },
            },
            { $project: { _id: 1 } },
          ],
          as: 'publicProblem',
        },
      },
      { $match: { publicProblem: { $ne: [] } } },
    ]);
    return rows.map((row) => ({
      maxPoints: row.maxPoints,
      solved: row.solved === 1,
    }));
  }

  /** Writes the user's points and returns what it replaced (null for a missing user), so the caller can tell whether the PP changed and for which organizations. */
  async setUserPoints(
    userId: string,
    points: UserPoints,
  ): Promise<{ performancePoints: number; organizations: string[] } | null> {
    const previous = await this.users
      .findOneAndUpdate(
        { _id: userId },
        { $set: points },
        { projection: { performancePoints: 1, organizations: 1 } },
      )
      .lean()
      .exec();
    return (
      previous && {
        performancePoints: previous.performancePoints,
        organizations: (previous.organizations ?? []).map(uuidStr),
      }
    );
  }

  /** Legacy `update_stats` counts over listed users: every submission, and the solved ones (`SOLVED_FILTER`, not legacy's "AC worth the problem's points") with their distinct users. Listed means `$nin` of the unlisted users' ids, read through the partial index: unlisted users are few (staff and test accounts), so the list stays small. A submission whose user has no `users` row counts as listed (legacy's join would drop it); only possible after a hard delete of a user. If they ever grow into the thousands, replace it with a `$lookup` of `users` on `user` filtered by `isUnlisted`. */
  async problemCounts(
    problemId: string,
  ): Promise<{ total: number; accepted: number; userCount: number }> {
    const unlisted = (
      await this.users.distinct('_id', { isUnlisted: true }).exec()
    ).map((id) => toUuid(uuidStr(id)));
    const listed = { problem: toUuid(problemId), user: { $nin: unlisted } };
    const [total, [accepted]] = await Promise.all([
      // Hinted: unhinted, the planner scans `{ problem, _id }` and fetches every row to test `user`.
      this.submissions
        .countDocuments(listed)
        .hint({ problem: 1, user: 1 })
        .exec(),
      this.submissions.aggregate<{ accepted: number; userCount: number }>([
        {
          $match: { ...listed, ...SOLVED_FILTER },
        },
        { $group: { _id: '$user', submissions: { $sum: 1 } } },
        {
          $group: {
            _id: null,
            accepted: { $sum: '$submissions' },
            userCount: { $sum: 1 },
          },
        },
      ]),
    ]);
    return {
      total,
      accepted: accepted?.accepted ?? 0,
      userCount: accepted?.userCount ?? 0,
    };
  }

  async setProblemStats(problemId: string, stats: ProblemStats): Promise<void> {
    await this.problems.updateOne({ _id: problemId }, { $set: stats }).exec();
  }
}
