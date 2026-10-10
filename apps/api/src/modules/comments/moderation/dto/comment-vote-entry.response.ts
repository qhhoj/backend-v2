import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class CommentVoteEntryResponse {
  /** The voter; null when the account is gone. */
  voter!: UserSummaryResponse | null;
  /** The vote: 1 or -1. */
  score!: number;
}
