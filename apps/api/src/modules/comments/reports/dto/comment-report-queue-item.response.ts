import { ApiProperty } from '@nestjs/swagger';
import { COMMENT_REPORT_REASONS } from '@libs/database';
import type { CommentReportReason } from '@libs/database';
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
  /** Users with an open report on it. */
  reporterCount!: number;
  /** Its open reports, oldest first. */
  reports!: CommentReportEntryResponse[];
  /** When the newest open report came in, ISO 8601. */
  lastReportedAt!: Date;
}
