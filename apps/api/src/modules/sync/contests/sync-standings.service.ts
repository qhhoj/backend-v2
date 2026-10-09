import { Injectable } from '@nestjs/common';
import type { ServiceClientPrincipal } from '@libs/auth';
import { AppError } from '@libs/common';
import { isFrozenFor } from '@libs/contests';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestRankingService } from '../../contests/ranking/contest-ranking.service';
import type { RankingResponse } from '../../contests/ranking/dto/ranking.response';
import { SyncContestOwnership } from './sync-contest-ownership.service';
import { SyncRateLimit } from './sync-rate-limit.service';

@Injectable()
export class SyncStandingsService {
  constructor(
    private readonly ownership: SyncContestOwnership,
    private readonly ranking: ContestRankingService,
    private readonly rateLimit: SyncRateLimit,
  ) {}

  /** What the public would see: nothing while the board is hidden from it, the frozen values during a freeze (never the live ones), live values otherwise. The client is never an editor. */
  async standings(
    client: ServiceClientPrincipal,
    key: string,
    now = new Date(),
  ): Promise<RankingResponse> {
    await this.rateLimit.charge(client);
    const contest = await this.ownership.require(client, key);
    if (
      !ContestAccess.boardVisible(null, ContestAccess.accessView(contest), now)
    )
      throw new AppError(
        'board_hidden',
        403,
        'The ranking of this contest is hidden',
      );
    return this.ranking.board(contest, {
      withVirtual: false,
      isFrozenView: isFrozenFor(contest, now, false),
      isCacheable: true,
    });
  }
}
