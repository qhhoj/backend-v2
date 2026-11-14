import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LowercaseUuid } from '@libs/common';
import { SHARE_TITLE_MAX_LENGTH } from '@libs/database';
import { SHARE_EXPIRIES } from '../../core/share-expiry';
import type { ShareExpiry } from '../../core/share-expiry';

export const SHARE_LIST_SCOPES = ['mine', 'all'] as const;
export type ShareListScope = (typeof SHARE_LIST_SCOPES)[number];

export class ShareListQueryDto {
  /** `mine` lists the caller's shares; `all` lists everyone's and needs `judge.manage_share`. */
  @ApiPropertyOptional({ enum: SHARE_LIST_SCOPES, enumName: 'ShareListScope' })
  @IsOptional()
  @IsIn(SHARE_LIST_SCOPES)
  scope: ShareListScope = 'mine';

  /** Only the copies of this submission (the share dialog's "already shared"). */
  @IsOptional() @LowercaseUuid() @IsUUID('7') submissionId?: string;

  /** Page number, starting at 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  /** Shares per page, 1-100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export class EditShareDto {
  /** New plain-text title; control characters are dropped. */
  @IsOptional()
  @IsString()
  @MaxLength(SHARE_TITLE_MAX_LENGTH)
  title?: string;

  /** New lifetime, counted from now. */
  @ApiPropertyOptional({ enum: SHARE_EXPIRIES, enumName: 'ShareExpiry' })
  @IsOptional()
  @IsIn(SHARE_EXPIRIES)
  expiry?: ShareExpiry;
}
