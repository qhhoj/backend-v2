import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Contest, Problem, Submission, User } from '@libs/database';
import { ContestAccess } from '../contests/core/contest-access';

/** Legacy `Problem.get_public_problems()`, minus soft-deleted problems. */
const PUBLIC_PROBLEMS = {
  isPublic: true,
  isOrganizationPrivate: false,
  deletedAt: null,
} as const;

/** `date` is null until a problem is published; those never reach the newest list. */
type DatedProblem = Problem & { date: Date };

@Injectable()
export class HomeRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  /** Newest public problems through `{isPublic, date}` (no `_id` tiebreak: it would force a blocking sort); the statement only for the feed. */
  newProblems(
    limit: number,
    { withStatement = false }: { withStatement?: boolean } = {},
  ): Promise<DatedProblem[]> {
    return this.problems
      .find(
        { ...PUBLIC_PROBLEMS, date: { $ne: null } },
        {
          code: 1,
          name: 1,
          points: 1,
          date: 1,
          ...(withStatement ? { descriptionHtml: 1 } : {}),
        },
      )
      .sort({ date: -1 })
      .limit(limit)
      .lean<DatedProblem[]>()
      .exec();
  }

  async counts(): Promise<{
    users: number;
    problems: number;
    submissions: number;
    contests: number;
  }> {
    const [users, problems, submissions, contests] = await Promise.all([
      this.users.estimatedDocumentCount().exec(),
      this.problems.countDocuments(PUBLIC_PROBLEMS).exec(),
      this.submissions.estimatedDocumentCount().exec(),
      this.contests.countDocuments(ContestAccess.visibleFilter(null)).exec(),
    ]);
    return { users, problems, submissions, contests };
  }
}
