import {
  RANKING_LINK_EXPIRY_MODES,
  RANKING_LINK_STATUSES,
} from '@libs/database';
import type { ContestPublicRankingLink } from '@libs/database';
import { IsIn, IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';
import { IsTimestamp } from '../../problems/dto/timestamp';

export class UpdateRankingLinkDto {
  @IsIn(RANKING_LINK_STATUSES) status!: ContestPublicRankingLink['status'];
  @IsIn(RANKING_LINK_EXPIRY_MODES)
  expiryMode!: ContestPublicRankingLink['expiryMode'];
  /** Minutes (M) or days (D). */
  @ValidateIf(
    (dto: UpdateRankingLinkDto) =>
      dto.expiryMode === 'M' || dto.expiryMode === 'D',
  )
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expiryAmount?: number;
  @ValidateIf((dto: UpdateRankingLinkDto) => dto.expiryMode === 'A')
  @IsTimestamp()
  expiresAt?: string;
}

export class TokenParamDto {
  /** Unvalidated: a malformed token is the same 404 as an unknown one. */
  @IsString() token!: string;
}
