import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { COMMENT_REPORT_REASONS } from '@libs/database';
import type { CommentReportReason } from '@libs/database';

export const REPORT_NOTE_MAX_LENGTH = 500;

export class ReportCommentDto {
  /** Why the comment is reported. */
  @ApiProperty({
    enum: COMMENT_REPORT_REASONS,
    enumName: 'CommentReportReason',
  })
  @IsIn(COMMENT_REPORT_REASONS)
  reason!: CommentReportReason;

  /** Optional details for the moderators. */
  @IsOptional()
  @IsString()
  @MaxLength(REPORT_NOTE_MAX_LENGTH)
  note?: string;
}

export const SETTLED_REPORT_STATUSES = ['resolved', 'dismissed'] as const;
export type SettledReportStatus = (typeof SETTLED_REPORT_STATUSES)[number];

export class SettleCommentReportsDto {
  /** `resolved` when the reports led to action, `dismissed` when they did not. */
  @ApiProperty({
    enum: SETTLED_REPORT_STATUSES,
    enumName: 'CommentReportOutcome',
  })
  @IsIn(SETTLED_REPORT_STATUSES)
  outcome!: SettledReportStatus;
}
