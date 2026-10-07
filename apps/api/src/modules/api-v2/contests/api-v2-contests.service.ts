import { Injectable } from '@nestjs/common';
import type { FilterQuery } from 'mongoose';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import {
  compareStandings,
  contestPhase,
  isFrozen,
  participationEnd,
  participationStart,
  problemLabel,
  standingOf,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest, ContestParticipation } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestViewerService } from '../../contests/core/contest-viewer.service';
import { ContestsRepository } from '../../contests/core/contests.repository';
import type { ContestDocument } from '../../contests/core/contests.repository';
import { ParticipationsRepository } from '../../contests/core/participations.repository';
import { RatingsRepository } from '../../contests/rating/ratings.repository';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ApiV2ContestListDto } from './dto/api-v2-contest-list.dto';
import { ApiV2ParticipationListDto } from './dto/api-v2-participation-list.dto';
import {
  API_V2_PAGE_SIZE,
  isoformat,
  legacyPage,
  legacyTotalPages,
} from '../core/legacy-envelope';
import type { LegacyPage } from '../core/legacy-envelope';

const notFound = () => new AppError('not_found', 404, 'page/object not found');

/** Legacy `/api/v2` contest reads. No contest scope here: standings of a freeze never leave the frozen fields for non-editors. */
@Injectable()
export class ApiV2ContestsService {
  constructor(
    private readonly viewers: ContestViewerService,
    private readonly contests: ContestsRepository,
    private readonly participations: ParticipationsRepository,
    private readonly ratings: RatingsRepository,
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Legacy `APIContestList`: visible contests by id. */
  async list(
    principal: Principal | null,
    query: ApiV2ContestListDto,
  ): Promise<LegacyPage<Record<string, unknown>>> {
    const clauses: FilterQuery<Contest>[] = [
      ContestAccess.visibleFilter(principal),
    ];
    if (query.is_rated !== undefined) clauses.push({ isRated: query.is_rated });
    if (query.key) clauses.push({ key: { $in: query.key } });
    if (query.tag) clauses.push({ tags: { $in: query.tag } });
    if (query.organization)
      clauses.push({ organizations: { $in: query.organization } });
    const { items, total } = await this.contests.list(
      { $and: clauses },
      { _id: 1 },
      query.page,
      API_V2_PAGE_SIZE,
    );
    if (query.page > legacyTotalPages(total)) throw notFound();
    return legacyPage(
      items.map((contest) => this.summary(contest)),
      query.page,
      total,
    );
  }

  /** Legacy `APIContestDetail`; the 404 `AppError` of an invisible contest gets the legacy body from `ApiV2ExceptionFilter`. */
  async detail(
    principal: Principal | null,
    key: string,
    now = new Date(),
  ): Promise<Record<string, unknown>> {
    const contest = await this.viewers.visibleContest(principal, key);
    const view = ContestAccess.accessView(contest);
    const viewer = await this.viewers.viewerOf(principal, contest, now);
    const canEdit = ContestAccess.canEdit(principal, view);
    const ordered = [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
    const problemIds = ordered.map((entry) => uuidStr(entry.problem));
    const showProblems =
      viewer.inContest || contestPhase(contest, now) === 'ended' || canEdit;
    const showRankings = ContestAccess.canSeeFullScoreboard(
      principal,
      view,
      now,
      viewer,
    );
    const summaries = new Map(
      (await this.problems.findSummaries(problemIds)).map((problem) => [
        problem._id,
        problem,
      ]),
    );
    return {
      ...this.summary(contest),
      has_rating: await this.ratings.hasRatings(contest._id),
      rating_floor: contest.ratingFloor,
      rating_ceiling: contest.ratingCeiling,
      hidden_scoreboard: ['C', 'P', 'H'].includes(contest.scoreboardVisibility),
      scoreboard_visibility: contest.scoreboardVisibility,
      is_organization_private: contest.isOrganizationPrivate,
      organizations: contest.isOrganizationPrivate ? view.organizations : [],
      is_private: contest.isPrivate,
      format: { name: contest.formatName, config: contest.formatConfig },
      problems: showProblems
        ? ordered.map((entry, index) => ({
            points: Math.trunc(entry.points),
            partial: entry.partial,
            is_pretested: entry.isPretested && contest.runPretestsOnly,
            max_submissions: entry.maxSubmissions || null,
            label: problemLabel(index, contest.labelStyle),
            name: summaries.get(problemIds[index])?.name ?? '',
            code: summaries.get(problemIds[index])?.code ?? '',
          }))
        : [],
      rankings: showRankings
        ? await this.rankings(
            contest,
            problemIds,
            isFrozen(contest, now) && !canEdit,
          )
        : [],
    };
  }

  /** Legacy `APIContestParticipationList`: spectators never, only contests whose scoreboard the viewer may read (the rule the detail's `rankings` follow). */
  async participationList(
    principal: Principal | null,
    query: ApiV2ParticipationListDto,
    now = new Date(),
  ): Promise<LegacyPage<Record<string, unknown>>> {
    // Legacy filtered on `user = None` for an unknown username: an empty first page, 404 after it.
    const user =
      query.user === undefined
        ? undefined
        : await this.users.findByUsername(query.user);
    if (user === null) {
      if (query.page > 1) throw notFound();
      return legacyPage([], 1, 0);
    }
    const contests = await this.contests.findAll({
      $and: [
        ContestAccess.visibleFilter(principal),
        ContestAccess.scoreboardFilter(principal, now),
        ...(query.contest ? [{ key: query.contest }] : []),
      ],
    });
    const filter: FilterQuery<ContestParticipation> = {
      contest: { $in: contests.map((contest) => uuidStr(contest._id)) },
      // Legacy's `virtual__gte=0` stays on top of the filter: `-1` matches nothing.
      virtual: {
        $gte: 0,
        ...(query.virtual_participation_number === undefined
          ? {}
          : { $eq: query.virtual_participation_number }),
      },
      ...(query.is_disqualified === undefined
        ? {}
        : { isDisqualified: query.is_disqualified }),
    };
    if (user) filter.user = user._id;
    const { items, total } = await this.participations.legacyPage(
      filter,
      query.page,
      API_V2_PAGE_SIZE,
    );
    if (query.page > legacyTotalPages(total)) throw notFound();
    const byId = new Map(
      contests.map((contest) => [uuidStr(contest._id), contest]),
    );
    const usernames = await this.participations.usernamesOf(
      unique(items.map((row) => uuidStr(row.user))),
    );
    return legacyPage(
      items.map((row) => {
        const contest = byId.get(uuidStr(row.contest))!;
        const standing = standingOf(
          row,
          isFrozen(contest, now) &&
            !ContestAccess.canEdit(
              principal,
              ContestAccess.accessView(contest),
            ),
        );
        return {
          user: usernames.get(uuidStr(row.user)) ?? '',
          contest: contest.key,
          start_time: isoformat(participationStart(contest, row)),
          end_time: isoformat(participationEnd(contest, row)),
          score: standing.score,
          cumulative_time: standing.cumtime,
          tiebreaker: standing.tiebreaker,
          is_disqualified: row.isDisqualified,
          virtual_participation_number: row.virtual,
        };
      }),
      query.page,
      total,
    );
  }

  private summary(contest: Contest): Record<string, unknown> {
    return {
      key: contest.key,
      name: contest.name,
      start_time: isoformat(contest.startTime),
      end_time: isoformat(contest.endTime),
      time_limit: contest.timeLimit,
      is_rated: contest.isRated,
      rate_all: contest.isRated && contest.rateAll,
      tags: contest.tags,
    };
  }

  /** Live rows ordered like the board the viewer may see, with legacy's rating columns. */
  private async rankings(
    contest: ContestDocument,
    problemIds: string[],
    frozen: boolean,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = (await this.participations.rankingRows(contest._id, false))
      .map((row) => ({ row, standing: standingOf(row, frozen) }))
      .sort(
        (left, right) =>
          compareStandings(left.standing, right.standing) ||
          uuidStr(left.row._id).localeCompare(uuidStr(right.row._id)),
      );
    const userIds = unique(rows.map(({ row }) => uuidStr(row.user)));
    const [usernames, newRatings, oldRatings] = await Promise.all([
      this.participations.usernamesOf(userIds),
      this.ratings.byParticipation(rows.map(({ row }) => uuidStr(row._id))),
      this.ratings.latestBefore(userIds, contest.endTime),
    ]);
    return rows.map(({ row, standing }) => ({
      user: usernames.get(uuidStr(row.user)) ?? '',
      start_time: isoformat(participationStart(contest, row)),
      end_time: isoformat(participationEnd(contest, row)),
      score: standing.score,
      cumulative_time: standing.cumtime,
      tiebreaker: standing.tiebreaker,
      // Ratings follow the live standings: a frozen board must not reveal them.
      old_rating: frozen ? null : (oldRatings.get(uuidStr(row.user)) ?? null),
      new_rating: frozen ? null : (newRatings.get(uuidStr(row._id)) ?? null),
      is_disqualified: row.isDisqualified,
      solutions: problemIds.map(
        (problemId) => standing.cells[problemId] ?? null,
      ),
    }));
  }
}
