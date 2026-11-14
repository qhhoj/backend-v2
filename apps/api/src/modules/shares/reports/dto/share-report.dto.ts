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
import { COMMENT_REPORT_STATUSES, SHARE_REPORT_REASONS } from '@libs/database';
import type { CommentReportStatus, ShareReportReason } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import {
  REPORT_NOTE_MAX_LENGTH,
  REPORT_QUEUES,
  SETTLED_REPORT_STATUSES,
} from '../../../comments/reports/dto/report-comment.dto';
import type { SettledReportStatus } from '../../../comments/reports/dto/report-comment.dto';
import { ShareSummaryResponse } from '../../core/dto/share.response';

export class ReportShareDto {
  /** Why: `spam`, `abuse`, `contest` (leaks a running contest's solution) or `other`. */
  @ApiProperty({ enum: SHARE_REPORT_REASONS, enumName: 'ShareReportReason' })
  @IsIn(SHARE_REPORT_REASONS)
  reason!: ShareReportReason;

  /** Optional details for staff. */
  @IsOptional()
  @IsString()
  @MaxLength(REPORT_NOTE_MAX_LENGTH)
  note?: string;
}

export class ShareReportQueueQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  /** `open` (the default) or `settled`. */
  @ApiPropertyOptional({ enum: REPORT_QUEUES, enumName: 'CommentReportQueue' })
  @IsOptional()
  @IsIn(REPORT_QUEUES)
  status: (typeof REPORT_QUEUES)[number] = 'open';
}

export class SettleShareReportsDto {
  /** `resolved` when the reports led to action, `dismissed` when they did not. */
  @ApiProperty({
    enum: SETTLED_REPORT_STATUSES,
    enumName: 'CommentReportOutcome',
  })
  @IsIn(SETTLED_REPORT_STATUSES)
  outcome!: SettledReportStatus;
}

export class ShareReportResponse {
  /** Report id. */
  id!: string;
  /** The reported share; null once it expired or was deleted. */
  share!: ShareSummaryResponse | null;
  /** Who reported; null when the account is gone. */
  reporter!: UserSummaryResponse | null;
  @ApiProperty({ enum: SHARE_REPORT_REASONS, enumName: 'ShareReportReason' })
  reason!: ShareReportReason;
  /** The reporter's note; may be empty. */
  note!: string;
  /** `open`, `resolved` or `dismissed`. */
  @ApiProperty({
    enum: COMMENT_REPORT_STATUSES,
    enumName: 'CommentReportStatus',
  })
  status!: CommentReportStatus;
  /** When it was reported. */
  createdAt!: Date;
  /** The staff member who settled it; null while open or when the account is gone. */
  settledBy!: UserSummaryResponse | null;
  /** When it was settled. */
  settledAt!: Date | null;
}
