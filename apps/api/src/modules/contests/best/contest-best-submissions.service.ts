import { Injectable } from '@nestjs/common';
import type { FilterQuery } from 'mongoose';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { BestSubmissionsRepository } from '../../submissions/best/best-submissions.repository';
import { SubmissionsService } from '../../submissions/core/submissions.service';
import type { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { ContestViewerService } from '../core/contest-viewer.service';
import { ContestsService } from '../core/contests.service';

/** One contest problem's submissions, none made at or after the freeze when the viewer sees a frozen board. */
export function contestBestFilter(
  contestId: string,
  problemId: string,
  frozenAt: Date | null,
): FilterQuery<Submission> {
  return {
    contest: contestId,
    problem: problemId,
    ...(frozenAt && { date: { $lt: frozenAt } }),
  };
}

/** The best submission of each user on one contest problem, under the ranking's visibility and freeze. */
@Injectable()
export class ContestBestSubmissionsService {
  constructor(
    private readonly contests: ContestsService,
    private readonly viewers: ContestViewerService,
    private readonly problems: ProblemsRepository,
    private readonly best: BestSubmissionsRepository,
    private readonly submissions: SubmissionsService,
  ) {}

  /** 403 unless the viewer may see the full ranking and the problem list; 404 for a problem the contest does not have. */
  async list(
    principal: Principal | null,
    { key, code }: { key: string; code: string },
    { page, pageSize }: { page: number; pageSize: number },
    now = new Date(),
  ): Promise<Paginated<SubmissionListItemResponse>> {
    const contest = await this.contests.visibleContest(principal, key);
    const facts = await this.viewers.viewerOf(principal, contest, now);
    const viewer = this.contests.viewerResponseOf(
      principal,
      contest,
      facts,
      now,
    );
    if (
      !viewer.canSeeFullScoreboard ||
      !this.contests.isProblemListOpen(contest, viewer, now)
    )
      throw new AppError(
        'forbidden',
        403,
        'The best submissions of this contest are hidden',
      );
    const problem = await this.problems.findByCode(code);
    const inContest = contest.problems.some(
      (entry) => uuidStr(entry.problem) === problem?._id,
    );
    if (!problem || !inContest)
      throw new AppError('not_found', 404, 'No such problem in this contest');
    const { items, total } = await this.best.page(
      contestBestFilter(contest._id, problem._id, viewer.boardFrozenAt),
      page,
      pageSize,
    );
    return new Paginated(await this.submissions.listItems(items), {
      page,
      pageSize,
      total,
    });
  }
}
