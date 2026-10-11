import { ApiProperty } from '@nestjs/swagger';
import { CONTEST_FORMAT_NAMES } from '@libs/database';
import type {
  ContestFormatName,
  ContestPublicRankingLink,
} from '@libs/database';
import { isLinkValid } from '../ranking-link';
import { RankingResponse } from './ranking.response';

export class RankingLinkResponse {
  /** The secret in the public URL. */
  token!: string;
  /** public or private. */
  status!: ContestPublicRankingLink['status'];
  /** U never expires, M minutes, D days, A at a fixed time. */
  expiryMode!: ContestPublicRankingLink['expiryMode'];
  /** Minutes or days for modes M and D, else null. */
  expiryAmount!: number | null;
  /** When the link stops working, ISO 8601; null if never. */
  expiresAt!: string | null;
  /** When the token was last generated, ISO 8601. */
  regeneratedAt!: string;
  /** Whether the link works now: public and not expired. */
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
  /** Key of the contest. */
  key!: string;
  /** Name of the contest. */
  name!: string;
  /** When the contest starts, ISO 8601. */
  startTime!: string;
  /** When the contest ends, ISO 8601. */
  endTime!: string;
  @ApiProperty({ enum: CONTEST_FORMAT_NAMES, enumName: 'ContestFormatName' })
  formatName!: ContestFormatName;
  /** Format-specific options, as in the contest detail. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'boolean' }] },
  })
  formatConfig!: Record<string, unknown>;
  /** Decimal places shown in scores. */
  pointsPrecision!: number;
}

export class PublicRankingResponse {
  contest!: PublicRankingContestResponse;
  ranking!: RankingResponse;
}
