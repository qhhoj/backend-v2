import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export const REPORT_QUEUES = ['open', 'settled'] as const;

export class CommentReportQueueQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  /** `open` (the default): comments with open reports. `settled`: comments whose reports were resolved or dismissed, newest settlement first. */
  @ApiPropertyOptional({ enum: REPORT_QUEUES, enumName: 'CommentReportQueue' })
  @IsOptional()
  @IsIn(REPORT_QUEUES)
  status: (typeof REPORT_QUEUES)[number] = 'open';
}
