import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Principal } from '@libs/auth';
import { AppError, REDIS, unique } from '@libs/common';
import {
  compareStandings,
  competitionRanks,
  isFrozen,
  problemLabel,
  problemSummaries,
  rankingCacheKey,
  standingOf,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestParticipation } from '@libs/database';
import { ProblemsRepository } from '../problems/problems.repository';
import { ContestAccess } from './contest-access';
import { ContestViewerService } from './contest-viewer.service';
import type { ContestDocument } from './contests.repository';
import { ContestsService } from './contests.service';
import type { RankingResponse } from './dto/ranking.response';
import { ParticipationsRepository } from './participations.repository';

/** Legacy `ContestRanking`, as JSON (the frontend renders cells from `formatData`). */
@Injectable()
export class ContestRankingService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly viewers: ContestViewerService,
    private readonly participations: ParticipationsRepository,
    private readonly problems: ProblemsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async ranking(
    principal: Principal | null,
    key: string,
    withVirtual: boolean,
    now = new Date(),
  ): Promise<RankingResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const view = ContestAccess.accessView(contest);
    const viewer = await this.viewers.viewerOf(principal, contest, now);
    if (!ContestAccess.canSeeOwnScoreboard(principal, view, now, viewer))
      throw new AppError(
        'forbidden',
        403,
        'The ranking of this contest is hidden',
      );
    const canEdit = ContestAccess.canEdit(principal, view);
    // Non-editors only ever see frozen standings during a freeze, their own row included.
    const frozen = isFrozen(contest, now) && !canEdit;
    if (!ContestAccess.canSeeFullScoreboard(principal, view, now, viewer))
      return this.build(
        contest,
        viewer.live ? [viewer.live.toObject()] : [],
        frozen,
        false,
      );
    const cacheable = contest.scoreboardCacheTimeout > 0 && !canEdit;
    const cacheKey = rankingCacheKey(contest._id, withVirtual, frozen);
    const hit = cacheable ? await this.redis.get(cacheKey) : null;
    if (hit) return JSON.parse(hit) as RankingResponse;
    const ranking = await this.build(
      contest,
      await this.participations.rankingRows(contest._id, withVirtual),
      frozen,
      true,
    );
    if (cacheable)
      await this.redis.set(
        cacheKey,
        JSON.stringify(ranking),
        'EX',
        contest.scoreboardCacheTimeout,
      );
    return ranking;
  }

  /**
   * Every row's standing (frozen or live, never mixed), sorted and ranked in memory.
   * Legacy's fifth sort key (`-submission_count`) is dropped: it needs a count per participation over the submissions
   * and only reorders rows that already share a rank, so those fall back to participation id order, stable across requests.
   */
  private async build(
    contest: ContestDocument,
    rows: ContestParticipation[],
    frozen: boolean,
    ranked: boolean,
  ): Promise<RankingResponse> {
    const standings = rows
      .map((row) => ({
        row,
        id: uuidStr(row._id),
        standing: standingOf(row, frozen),
      }))
      .sort(
        (left, right) =>
          compareStandings(left.standing, right.standing) ||
          left.id.localeCompare(right.id),
      );
    const ranks = competitionRanks(standings.map(({ standing }) => standing));
    const usernames = await this.participations.usernamesOf(
      unique(rows.map((row) => uuidStr(row.user))),
    );
    const ordered = [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
    const codes = new Map(
      (
        await this.problems.findSummaries(
          ordered.map((entry) => uuidStr(entry.problem)),
        )
      ).map((problem) => [problem._id, problem.code]),
    );
    const summaries = problemSummaries(
      { name: contest.formatName, config: contest.formatConfig },
      ordered.map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      })),
      standings.map(({ row, id, standing }) => ({
        participationId: id,
        virtual: row.virtual,
        cells: standing.cells,
      })),
    );
    return {
      frozen,
      problems: ordered.map((entry, index) => {
        const problemId = uuidStr(entry.problem);
        return {
          problemId,
          code: codes.get(problemId) ?? '',
          label: problemLabel(index, contest.labelStyle),
          points: entry.points,
          ...summaries.get(problemId)!,
        };
      }),
      rows: standings.map(({ row, id, standing }, index) => {
        const userId = uuidStr(row.user);
        return {
          rank: ranked ? ranks[index] : null,
          participationId: id,
          user: { id: userId, username: usernames.get(userId) ?? '' },
          virtual: row.virtual,
          ...standing,
        };
      }),
    };
  }
}
