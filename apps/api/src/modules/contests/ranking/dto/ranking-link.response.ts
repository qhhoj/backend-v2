import type { ContestPublicRankingLink } from '@libs/database';
import { isLinkValid } from '../ranking-link';
import { RankingResponse } from './ranking.response';

export class RankingLinkResponse {
  token!: string;
  status!: ContestPublicRankingLink['status'];
  expiryMode!: ContestPublicRankingLink['expiryMode'];
  expiryAmount!: number | null;
  expiresAt!: string | null;
  regeneratedAt!: string;
  isValid!: boolean;

  static from(link: ContestPublicRankingLink, now: Date): RankingLinkResponse {
    return {
      token: link.token,
      status: link.status,
      expiryMode: link.expiryMode,
      expiryAmount: link.expiryAmount,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      regeneratedAt: link.regeneratedAt.toISOString(),
      isValid: isLinkValid(link, now),
    };
  }
}

export class PublicRankingContestResponse {
  key!: string;
  name!: string;
  startTime!: string;
  endTime!: string;
}

export class PublicRankingResponse {
  contest!: PublicRankingContestResponse;
  ranking!: RankingResponse;
}
