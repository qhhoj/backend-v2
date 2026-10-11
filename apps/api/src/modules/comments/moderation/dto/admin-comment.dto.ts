import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { COMMENT_PAGE_TYPES } from '@libs/community';
import type { CommentPageType } from '@libs/community';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { CommentPageLinkResponse } from '../../core/dto/comment.response';
import { ReportedCommentResponse } from '../../reports/dto/comment-report-queue-item.response';

export const ADMIN_COMMENT_STATES = ['all', 'visible', 'hidden'] as const;
export type AdminCommentState = (typeof ADMIN_COMMENT_STATES)[number];

/** The moderators' search over every comment of the site. */
export class AdminCommentQueryDto {
  /** Text the comment body contains (case-insensitive). */
  @IsOptional() @IsString() @MaxLength(100) search?: string;

  /** Exact username of the author. */
  @IsOptional() @IsString() @MaxLength(100) author?: string;

  /** `visible`, `hidden` or `all` (default). Deleted comments are listed as placeholders, except in a body search. */
  @ApiPropertyOptional({
    enum: ADMIN_COMMENT_STATES,
    enumName: 'AdminCommentState',
  })
  @IsOptional()
  @IsIn(ADMIN_COMMENT_STATES)
  state: AdminCommentState = 'all';

  /** Only comments on this kind of page. */
  @ApiPropertyOptional({
    enum: COMMENT_PAGE_TYPES,
    enumName: 'CommentPageType',
  })
  @IsOptional()
  @IsIn(COMMENT_PAGE_TYPES)
  pageType?: CommentPageType;

  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

export class AdminCommentItemResponse {
  /** The comment. */
  comment!: ReportedCommentResponse;
  /** The page it belongs to. */
  page!: CommentPageLinkResponse;
  /** When it was posted, ISO 8601. */
  createdAt!: Date;
  /** The moderator who hid it; null when visible or the account is gone. */
  hiddenBy!: UserSummaryResponse | null;
}
