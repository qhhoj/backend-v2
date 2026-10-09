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
  /** Checked against the same-site allow-list by the service (a 400 `path` issue), not by a pattern here. */
  @IsString() @MaxLength(MAX_SHORT_PATH_LENGTH) path!: string;
  /** Staff only. */
  @IsOptional() @Matches(CUSTOM_SHORT_CODE_PATTERN) code?: string;
  /** Staff only. */
  @IsOptional() @IsTimestamp() expiresAt?: string;
}

export const SHORT_LINK_SCOPES = ['own', 'all'] as const;
export type ShortLinkScope = (typeof SHORT_LINK_SCOPES)[number];

export class ShortLinkListQueryDto {
  /** `ShortLinkScope` is an alias of a union, so the plugin would drop it: spelled out (SDK R3). */
  @ApiPropertyOptional({ enum: SHORT_LINK_SCOPES, enumName: 'ShortLinkScope' })
  @IsOptional()
  @IsIn(SHORT_LINK_SCOPES)
  scope: ShortLinkScope = 'own';
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
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
  @IsString() code!: string;
}
