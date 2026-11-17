import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import type { SubmissionListQueryDto } from '../../submissions/core/dto/submission-list.dto';
import type { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { SubmissionsService } from '../../submissions/core/submissions.service';
import { ContestAccess } from '../core/contest-access';
import { ContestViewerService } from '../core/contest-viewer.service';
import { ContestsService } from '../core/contests.service';

/** Legacy contest submission lists: everyone's when `canSeeFullSubmissionList`, else the viewer's own. Before the start the list is empty for whoever may not see the problems yet. */
@Injectable()
export class ContestSubmissionsService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly viewers: ContestViewerService,
    private readonly submissions: SubmissionsService,
  ) {}

  async list(
    principal: Principal | null,
    key: string,
    query: SubmissionListQueryDto,
    now = new Date(),
  ): Promise<Paginated<SubmissionListItemResponse>> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const viewer = await this.viewers.viewerOf(principal, contest, now);
    const contestId = contest._id;
    if (
      ContestAccess.hidesProblemsBeforeStart(
        principal,
        ContestAccess.accessView(contest),
        now,
      )
    )
      return new Paginated([], {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
      });
    if (
      ContestAccess.canSeeFullSubmissionList(
        principal,
        ContestAccess.accessView(contest),
        now,
        viewer,
      )
    )
      return this.submissions.list(principal, query, { contestId });
    if (
      !principal ||
      (query.user !== undefined && query.user !== principal.username)
    )
      throw new AppError(
        'forbidden',
        403,
        'You can only see your own submissions in this contest',
      );
    return this.submissions.list(
      principal,
      { ...query, user: principal.username },
      { contestId },
    );
  }
}
