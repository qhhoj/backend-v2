import { CUSTOM_SHORT_CODE_PATTERN } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsTimestamp } from '../../problems/core/dto/timestamp';
import { MAX_SHORT_PATH_LENGTH } from '../short-target';

export class CreateShortLinkDto {
  /**
   * Site path to shorten, for example `/problems/aplusb`; only problems, contests, posts, users and organizations are accepted (otherwise 400).
   */
  @IsString() @MaxLength(MAX_SHORT_PATH_LENGTH) path!: string;
  /** Custom short code. Staff only (`judge.manage_short_link`). */
  @IsOptional() @Matches(CUSTOM_SHORT_CODE_PATTERN) code?: string;
  /**
   * When the link stops working, ISO 8601, in the future. Staff only (`judge.manage_short_link`).
   */
  @IsOptional() @IsTimestamp() expiresAt?: string;
}

export const SHORT_LINK_SCOPES = ['own', 'all'] as const;
export type ShortLinkScope = (typeof SHORT_LINK_SCOPES)[number];

export class ShortLinkListQueryDto {
  /**
   * `own` lists the caller's links; `all` lists every link and needs `judge.manage_short_link`.
   */
  @ApiPropertyOptional({ enum: SHORT_LINK_SCOPES, enumName: 'ShortLinkScope' })
  @IsOptional()
  @IsIn(SHORT_LINK_SCOPES)
  scope: ShortLinkScope = 'own';
  /** Page number, starting at 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Links per page, 1-100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

/** Unvalidated shape: an unknown code is a 404, never a 400. */
export class ShortCodeParamDto {
  /** Short code; matched case-insensitively, unknown gives 404. */
  @IsString() code!: string;
}
