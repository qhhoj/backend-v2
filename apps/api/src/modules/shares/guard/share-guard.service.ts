import { Injectable } from '@nestjs/common';
import { uuidStr } from '@libs/database';
import type { Contest, Problem } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { sourceVisibilityOf } from '../../submissions/core/submission-access';
import type { CopyRefusal } from '../core/share-hidden-reason';
import { isContestOpenForShares } from './share-contest-rule';

/** Source visibility `O`: the setter shows sources to owners and testers only. */
const OWNER_AND_TESTERS_ONLY = 'O';

export interface CopySubject {
  problemId: string;
  /** Deleted ones included; null when the row is gone. */
  problem: Pick<
    Problem,
    | 'submissionSourceVisibility'
    | 'isPublic'
    | 'isOrganizationPrivate'
    | 'deletedAt'
  > | null;
  /** The contest the submission was made in; a deleted contest counts as open. */
  contestId: string | null;
}

/** The rules a submission's frozen copy answers to, at share time and again on every read. */
@Injectable()
export class ShareGuardService {
  constructor(private readonly contests: ContestsRepository) {}

  /**
   * Null when the copy may be shown: the problem is public to signed-out visitors, its setter shows sources, and
   * every contest that lists the problem or holds the submission has ended with an open board.
   */
  async refusalOf(
    subject: CopySubject,
    now: Date,
  ): Promise<CopyRefusal | null> {
    const { problem } = subject;
    if (!problem || problem.deletedAt || !ProblemAccess.isSitePublic(problem))
      return 'problem_hidden';
    if (sourceVisibilityOf(problem) === OWNER_AND_TESTERS_ONLY)
      return 'source_hidden';
    const contests = await this.contestsOf(subject);
    const isOpen = contests.every((contest) =>
      isContestOpenForShares(ContestAccess.accessView(contest), now),
    );
    return isOpen ? null : 'contest_running';
  }

  /** A practice submission counts too: the problem may be in a running contest. */
  private async contestsOf({
    problemId,
    contestId,
  }: CopySubject): Promise<Contest[]> {
    const [listing, own] = await Promise.all([
      this.contests.findByProblem(problemId),
      contestId
        ? this.contests.findByIds([contestId])
        : Promise.resolve<Contest[]>([]),
    ]);
    const listed = new Set(listing.map((contest) => uuidStr(contest._id)));
    return [
      ...listing,
      ...own.filter((contest) => !listed.has(uuidStr(contest._id))),
    ];
  }
}
