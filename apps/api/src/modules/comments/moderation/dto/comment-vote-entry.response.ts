import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class CommentVoteEntryResponse {
  voter!: UserSummaryResponse | null;
  score!: number;
}
