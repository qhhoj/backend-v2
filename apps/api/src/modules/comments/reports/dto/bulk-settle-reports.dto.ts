import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
} from 'class-validator';
import { SETTLED_REPORT_STATUSES } from './report-comment.dto';
import type { SettledReportStatus } from './report-comment.dto';

export const BULK_SETTLE_MAX = 50;

export class BulkSettleReportsDto {
  /** Ids of the reported comments, at most 50; duplicates count once. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_SETTLE_MAX)
  @IsString({ each: true })
  ids!: string[];

  /** `resolved` when the reports led to action, `dismissed` when they did not. */
  @ApiProperty({
    enum: SETTLED_REPORT_STATUSES,
    enumName: 'CommentReportOutcome',
  })
  @IsIn(SETTLED_REPORT_STATUSES)
  outcome!: SettledReportStatus;
}

export class BulkSettleOutcomeResponse {
  /** Id of the comment. */
  id!: string;
  /** Null when its open reports were settled; otherwise the error code that refused it (`not_found`). */
  code!: string | null;
}
