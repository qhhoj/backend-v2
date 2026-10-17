import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { escapeRegExp, Paginated } from '@libs/common';
import { frozenTime, isFrozenFor, liveStatusOf } from '@libs/contests';
import { narrowTo, uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import type { FilterQuery, SortOrder } from 'mongoose';
import { ContestAccess } from './contest-access';
import { ContestOrganizationsService } from './contest-organizations.service';
import { ContestProblemFactsService } from './contest-problem-facts.service';
import { ContestViewerService } from './contest-viewer.service';
import type { ContestViewer } from './contest-viewer.service';
import { ContestsRepository } from './contests.repository';
import type { ContestDocument } from './contests.repository';
import { ParticipationsRepository } from './participations.repository';
import {
  ContestDetailResponse,
  ContestSettingsResponse,
  ParticipationSummaryResponse,
} from './dto/contest-detail.response';
import type {
  ContestViewerAccess,
  ContestViewerResponse,
} from './dto/contest-detail.response';
import { RatingChangesRepository } from '../rating/rating-changes.repository';
import type {
  ContestListQueryDto,
  ContestListSort,
} from './dto/contest-list.dto';
import { ContestListItemResponse } from './dto/contest-list.response';
import type { ContestListEditorResponse } from './dto/contest-list.response';

const SORTS: Record<ContestListSort, Record<string, SortOrder>> = {
  newest: { startTime: -1, key: 1 },
  oldest: { startTime: 1, key: 1 },
  name: { name: 1, key: 1 },
  users: { userCount: -1, key: 1 },
};

function listSortOf(query: ContestListQueryDto): Record<string, SortOrder> {
  if (query.sort) return SORTS[query.sort];
  return query.phase === 'upcoming' ? SORTS.oldest : SORTS.newest;
}

function phaseClauses(
  query: ContestListQueryDto,
  now: Date,
): FilterQuery<Contest>[] {
  const clauses: FilterQuery<Contest>[] = [];
  if (query.phase === 'upcoming') clauses.push({ startTime: { $gt: now } });
  if (query.phase === 'running')
    clauses.push({ startTime: { $lte: now }, endTime: { $gte: now } });
  if (query.phase === 'ended') clauses.push({ endTime: { $lt: now } });
  if (query.startFrom)
    clauses.push({ startTime: { $gte: new Date(query.startFrom) } });
  if (query.startBefore)
    clauses.push({ startTime: { $lt: new Date(query.startBefore) } });
  return clauses;
}

/** The admin index's filters; `visible=false` adds nothing a viewer could not already list, since `visibleFilter` shows hidden contests only to their insiders. */
function staffClauses(
  principal: Principal | null,
  query: ContestListQueryDto,
): FilterQuery<Contest>[] {
  const clauses: FilterQuery<Contest>[] = [];
  if (query.editable !== undefined)
    clauses.push(
      narrowTo(ContestAccess.editableFilter(principal), query.editable),
    );
  if (query.visible !== undefined) clauses.push({ isVisible: query.visible });
  if (query.mine !== undefined) {
    const mine = principal && {
      $or: [
        { authors: principal.userId },
        { curators: principal.userId },
        { testers: principal.userId },
      ],
    };
    clauses.push(narrowTo(mine, query.mine));
  }
  return clauses;
}

const editorRowOf = (
  contest: Contest,
  pending: Map<string, number>,
): ContestListEditorResponse => ({
  isVisible: contest.isVisible,
  lockedAfter: contest.lockedAfter,
  pendingCount:
    contest.formatName === 'final_submission'
      ? (pending.get(uuidStr(contest._id)) ?? 0)
      : null,
});

@Injectable()
export class ContestsService {
  constructor(
    private readonly contests: ContestsRepository,
    private readonly participations: ParticipationsRepository,
    private readonly viewers: ContestViewerService,
    private readonly problemFacts: ContestProblemFactsService,
    private readonly organizations: ContestOrganizationsService,
    private readonly users: UsersRepository,
    private readonly ratingChanges: RatingChangesRepository,
  ) {}

  /** Legacy `ContestList` over `get_visible_contests`; upcoming soonest first, the rest newest first unless `sort` says otherwise; each row carries the signed-in viewer's own state, and the editor block for contests they may edit. */
  async list(
    principal: Principal | null,
    query: ContestListQueryDto,
    now = new Date(),
  ): Promise<Paginated<ContestListItemResponse>> {
    const { items, total } = await this.contests.list(
      this.listFilter(principal, query, now),
      listSortOf(query),
      query.page,
      query.pageSize,
    );
    const editable = items.filter((contest) =>
      ContestAccess.canEdit(principal, ContestAccess.accessView(contest)),
    );
    const [viewers, organizations, pending] = await Promise.all([
      this.viewers.listViewersOf(principal, items, now),
      this.organizations.forContests(principal, items),
      this.contests.pendingCountsOf(
        editable
          .filter((contest) => contest.formatName === 'final_submission')
          .map((contest) => uuidStr(contest._id)),
      ),
    ]);
    const editableIds = new Set(
      editable.map((contest) => uuidStr(contest._id)),
    );
    return new Paginated(
      items.map((contest) => {
        const id = uuidStr(contest._id);
        return ContestListItemResponse.withViewer(contest, now, {
          // `viewers` is empty for a signed-out visitor, so the row has no viewer.
          viewer: viewers.get(id) ?? null,
          organizations: organizations.get(id) ?? [],
          editor: editableIds.has(id) ? editorRowOf(contest, pending) : null,
        });
      }),
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
      ...phaseClauses(query, now),
      ...staffClauses(principal, query),
    ];
    if (query.tag) clauses.push({ tags: query.tag });
    if (query.organization) clauses.push({ organizations: query.organization });
    if (query.rated !== undefined) clauses.push({ isRated: query.rated });
    for (const text of [query.search, query.q]) {
      const trimmed = text?.trim();
      if (!trimmed) continue;
      const pattern = new RegExp(escapeRegExp(trimmed), 'i');
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
    const viewerFacts = await this.viewers.viewerOf(principal, contest, now);
    const access = this.viewerResponseOf(principal, contest, viewerFacts, now);
    if (access.canEdit) await this.refreshCounts(contest);
    const viewer: ContestViewerResponse = {
      ...access,
      ratingChange: await this.viewerRatingChange(contest, viewerFacts, access),
    };
    const [authors, settingsUsers, problems, organizations] = await Promise.all(
      [
        this.users.findByIds(ContestAccess.accessView(contest).authors),
        this.settingsUsers(contest, viewer),
        ContestAccess.isProblemListOpen(
          principal,
          ContestAccess.accessView(contest),
          viewerFacts,
          now,
        )
          ? this.problemFacts.factsFor(principal, contest, viewerFacts, now)
          : null,
        this.organizations.forContests(principal, [contest]),
      ],
    );
    return ContestDetailResponse.fromDetail(contest, {
      now,
      organizations: organizations.get(uuidStr(contest._id)) ?? [],
      authors,
      problems,
      viewer,
      settingsUsers,
    });
  }

  /**
   * An editor reads the participant counts from the rows themselves: the stored counts drift when rows are written outside
   * the participation services (seeds, imports). A drift is written back, so the lists and the public page follow.
   */
  private async refreshCounts(contest: ContestDocument): Promise<void> {
    const counts = await this.participations.countsOf(uuidStr(contest._id));
    if (
      counts.userCount === contest.userCount &&
      counts.virtualCount === contest.virtualCount
    )
      return;
    await this.contests.setCounts(uuidStr(contest._id), counts);
    contest.userCount = counts.userCount;
    contest.virtualCount = counts.virtualCount;
  }

  /** The viewer's live row once rated; never on a board still frozen for them (as the ranking's `ratingChange`). */
  private viewerRatingChange(
    contest: Contest,
    viewer: ContestViewer,
    access: ContestViewerAccess,
  ): Promise<ContestViewerResponse['ratingChange']> {
    if (!viewer.live || !contest.isRated || access.boardFrozenAt !== null)
      return Promise.resolve(null);
    return this.ratingChanges.ofParticipation(uuidStr(viewer.live._id));
  }

  /** The users the settings name, for editors only; nobody else reads them. */
  private settingsUsers(
    contest: Contest,
    viewer: ContestViewerResponse,
  ): Promise<UserDocument[]> {
    return viewer.canEdit
      ? this.users.findByIds(ContestSettingsResponse.userIdsOf(contest))
      : Promise.resolve([]);
  }

  viewerResponseOf(
    principal: Principal | null,
    contest: ContestDocument,
    viewer: ContestViewer,
    now: Date,
  ): ContestViewerAccess {
    const view = ContestAccess.accessView(contest);
    const canEdit = ContestAccess.canEdit(principal, view);
    return {
      canEdit,
      isEditor: ContestAccess.isEditor(principal, view),
      isTester: ContestAccess.isTester(principal, view),
      canViewBalloons:
        contest.balloons && ContestAccess.canViewBalloons(principal, view),
      canSeeFullScoreboard: ContestAccess.canSeeFullScoreboard(
        principal,
        view,
        now,
        viewer,
      ),
      boardFrozenAt: isFrozenFor(contest, now, canEdit)
        ? frozenTime(contest)
        : null,
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
  editableContest(principal: Principal, key: string): Promise<ContestDocument> {
    return this.viewers.editableContest(principal, key);
  }
}
