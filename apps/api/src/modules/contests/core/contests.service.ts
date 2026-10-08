import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, escapeRegExp, Paginated } from '@libs/common';
import { contestPhase, liveStatusOf } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import type { FilterQuery, SortOrder } from 'mongoose';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestAccess } from './contest-access';
import { ContestViewerService } from './contest-viewer.service';
import type { ContestViewer } from './contest-viewer.service';
import { ContestsRepository } from './contests.repository';
import type { ContestDocument } from './contests.repository';
import {
  ContestDetailResponse,
  ContestViewerResponse,
  ParticipationSummaryResponse,
} from './dto/contest-detail.response';
import type { ContestListQueryDto } from './dto/contest-list.dto';
import { ContestListItemResponse } from './dto/contest-list.response';

@Injectable()
export class ContestsService {
  constructor(
    private readonly contests: ContestsRepository,
    private readonly viewers: ContestViewerService,
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Legacy `ContestList` over `get_visible_contests`; upcoming soonest first, the rest newest first; each row carries the signed-in viewer's own state. */
  async list(
    principal: Principal | null,
    query: ContestListQueryDto,
    now = new Date(),
  ): Promise<Paginated<ContestListItemResponse>> {
    const sort: Record<string, SortOrder> =
      query.phase === 'upcoming'
        ? { startTime: 1, key: 1 }
        : { startTime: -1, key: 1 };
    const { items, total } = await this.contests.list(
      this.listFilter(principal, query, now),
      sort,
      query.page,
      query.pageSize,
    );
    const viewers = await this.viewers.listViewersOf(principal, items, now);
    return new Paginated(
      items.map((contest) =>
        ContestListItemResponse.withViewer(
          contest,
          now,
          viewers.get(uuidStr(contest._id)) ?? null,
        ),
      ),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  private listFilter(
    principal: Principal | null,
    query: ContestListQueryDto,
    now: Date,
  ): FilterQuery<Contest> {
    const clauses: FilterQuery<Contest>[] = [
      ContestAccess.visibleFilter(principal),
    ];
    if (query.phase === 'upcoming') clauses.push({ startTime: { $gt: now } });
    if (query.phase === 'running')
      clauses.push({ startTime: { $lte: now }, endTime: { $gte: now } });
    if (query.phase === 'ended') clauses.push({ endTime: { $lt: now } });
    if (query.tag) clauses.push({ tags: query.tag });
    if (query.organization) clauses.push({ organizations: query.organization });
    if (query.rated !== undefined) clauses.push({ isRated: query.rated });
    if (query.search) {
      const pattern = new RegExp(escapeRegExp(query.search), 'i');
      clauses.push({ $or: [{ key: pattern }, { name: pattern }] });
    }
    return { $and: clauses };
  }

  async detail(
    principal: Principal | null,
    key: string,
    now = new Date(),
  ): Promise<ContestDetailResponse> {
    const contest = await this.visibleContest(principal, key);
    const viewer = this.viewerResponseOf(
      principal,
      contest,
      await this.viewers.viewerOf(principal, contest, now),
      now,
    );
    const [authors, problems] = await Promise.all([
      this.users.findByIds(ContestAccess.accessView(contest).authors),
      this.isProblemListOpen(contest, viewer, now)
        ? this.problems.findSummaries(
            contest.problems.map((entry) => uuidStr(entry.problem)),
          )
        : null,
    ]);
    return ContestDetailResponse.fromDetail(contest, {
      now,
      authors,
      problems:
        problems &&
        problems.map(({ _id, code, name }) => ({ _id, code, name })),
      viewer,
    });
  }

  /** Problems show to whoever is in the contest, edits or tests it, and to everyone once it ended. */
  private isProblemListOpen(
    contest: Contest,
    viewer: ContestViewerResponse,
    now: Date,
  ): boolean {
    return (
      viewer.inContest ||
      viewer.isEditor ||
      viewer.canEdit ||
      viewer.isTester ||
      contestPhase(contest, now) === 'ended'
    );
  }

  private viewerResponseOf(
    principal: Principal | null,
    contest: ContestDocument,
    viewer: ContestViewer,
    now: Date,
  ): ContestViewerResponse {
    const view = ContestAccess.accessView(contest);
    return {
      canEdit: ContestAccess.canEdit(principal, view),
      isEditor: ContestAccess.isEditor(principal, view),
      isTester: ContestAccess.isTester(principal, view),
      inContest: viewer.inContest,
      liveParticipation:
        viewer.live && ParticipationSummaryResponse.from(viewer.live, contest),
      liveStatus: liveStatusOf(contest, viewer.live, now),
      isCurrent: viewer.current !== null,
    };
  }

  visibleContest(
    principal: Principal | null,
    key: string,
  ): Promise<ContestDocument> {
    return this.viewers.visibleContest(principal, key);
  }

  /** `visibleContest` plus legacy `is_editable_by` (403 when visible but not editable). */
  async editableContest(
    principal: Principal,
    key: string,
  ): Promise<ContestDocument> {
    const contest = await this.visibleContest(principal, key);
    if (!ContestAccess.canEdit(principal, ContestAccess.accessView(contest)))
      throw new AppError('forbidden', 403, 'You cannot edit this contest');
    return contest;
  }
}
