import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { isFrozen } from '@libs/contests';
import { RANKING_LINK_TOKEN_PATTERN, uuidStr } from '@libs/database';
import { ContestAccess } from './contest-access';
import { ContestRankingService } from './contest-ranking.service';
import { ContestsRepository } from './contests.repository';
import { ContestsService } from './contests.service';
import type { UpdateRankingLinkDto } from './dto/ranking-link.dto';
import {
  PublicRankingResponse,
  RankingLinkResponse,
} from './dto/ranking-link.response';
import { isLinkValid, linkExpiry } from './ranking-link';
import { RankingLinksRepository } from './ranking-links.repository';
import {
  RANKING_TOKEN_MISS_LIMIT,
  RANKING_TOKEN_WINDOW_SECONDS,
} from './rate-limits';

/** Legacy `PublicRankingView` and the editors' link settings. */
@Injectable()
export class RankingLinksService {
  constructor(
    private readonly links: RankingLinksRepository,
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    private readonly rankings: ContestRankingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async show(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<RankingLinkResponse> {
    return RankingLinkResponse.from(await this.linkOf(principal, key), now);
  }

  async create(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<RankingLinkResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    return RankingLinkResponse.from(
      await this.links.getOrCreate(contest._id, now),
      now,
    );
  }

  /** Legacy `apply_settings`: everything validated first, one write. */
  async update(
    principal: Principal,
    key: string,
    dto: UpdateRankingLinkDto,
    now = new Date(),
  ): Promise<RankingLinkResponse> {
    const link = await this.linkOf(principal, key);
    const settings = {
      expiryMode: dto.expiryMode,
      expiryAmount: dto.expiryAmount ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    };
    const updated = await this.links.update(link._id, {
      status: dto.status,
      ...settings,
      expiresAt: linkExpiry(settings, link.regeneratedAt),
    });
    return RankingLinkResponse.from(updated!, now);
  }

  async regenerate(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<RankingLinkResponse> {
    const link = await this.linkOf(principal, key);
    return RankingLinkResponse.from(
      (await this.links.regenerate(link, now))!,
      now,
    );
  }

  /** One 404 for every miss, each spending the IP's budget; a hit gives it back. */
  async publicRanking(
    token: string,
    ip: string,
    now = new Date(),
  ): Promise<PublicRankingResponse> {
    const release = await this.rateLimit.reserve(
      [`ranking-link:ip:${ip}`],
      RANKING_TOKEN_MISS_LIMIT,
      RANKING_TOKEN_WINDOW_SECONDS,
    );
    const link = RANKING_LINK_TOKEN_PATTERN.test(token)
      ? await this.links.findByToken(token)
      : null;
    const contest =
      link && isLinkValid(link, now)
        ? await this.contests.findById(uuidStr(link.contest))
        : null;
    if (
      !contest ||
      !ContestAccess.showScoreboard(ContestAccess.accessView(contest), now)
    )
      throw new AppError('not_found', 404, 'No such ranking');
    await release();
    return {
      contest: {
        key: contest.key,
        name: contest.name,
        startTime: contest.startTime.toISOString(),
        endTime: contest.endTime.toISOString(),
      },
      ranking: await this.rankings.board(
        contest,
        false,
        isFrozen(contest, now),
        true,
      ),
    };
  }

  private async linkOf(principal: Principal, key: string) {
    const contest = await this.contestsService.editableContest(principal, key);
    const link = await this.links.findByContest(contest._id);
    if (!link)
      throw new AppError(
        'not_found',
        404,
        'This contest has no public ranking link',
      );
    return link;
  }
}
