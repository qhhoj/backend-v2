import { ApiProperty } from '@nestjs/swagger';
import {
  COMMENT_REPORT_REASONS,
  COMMENT_REPORT_STATUSES,
} from '@libs/database';
import type { CommentReportReason, CommentReportStatus } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { CommentPageLinkResponse } from '../../core/dto/comment.response';

export class CommentReportEntryResponse {
  /** Who reported; null when the account is gone. */
  reporter!: UserSummaryResponse | null;
  /** Why it was reported. */
  @ApiProperty({
    enum: COMMENT_REPORT_REASONS,
    enumName: 'CommentReportReason',
  })
  reason!: CommentReportReason;
  /** The reporter's note; may be empty. */
  note!: string;
  /** When it was reported, ISO 8601. */
  createdAt!: Date;
  /** `open`, or how a moderator settled it. */
  @ApiProperty({
    enum: COMMENT_REPORT_STATUSES,
    enumName: 'CommentReportStatus',
  })
  status!: CommentReportStatus;
  /** The moderator who settled it; null while open or when the account is gone. */
  settledBy!: UserSummaryResponse | null;
  /** When it was settled, ISO 8601; null while open. */
  settledAt!: Date | null;
}

export class ReportedCommentResponse {
  /** Id of the comment. */
  id!: string;
  /** The first 200 characters of its Markdown; empty once deleted. */
  excerpt!: string;
  /** Null when the author's account is gone. */
  author!: UserSummaryResponse | null;
  /** Hidden by a moderator. */
  hidden!: boolean;
  /** Deleted by its author or a moderator. */
  deleted!: boolean;
}

export class CommentReportQueueItemResponse {
  /** The reported comment. */
  comment!: ReportedCommentResponse;
  /** The page it belongs to. */
  page!: CommentPageLinkResponse;
  /** Users with a report on it in this list (open, or settled). */
  reporterCount!: number;
  /** Its reports in this list, oldest first. */
  reports!: CommentReportEntryResponse[];
  /** When the newest of those reports came in, ISO 8601. */
  lastReportedAt!: Date;
  /** In the settled list, when the newest of its reports was settled, ISO 8601; null in the open list. */
  lastSettledAt!: Date | null;
}
