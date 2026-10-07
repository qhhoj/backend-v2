import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class CommentRevisionResponse {
  at!: Date;
  editor!: UserSummaryResponse | null;
  /** Markdown before and after the edit. */
  before!: string;
  after!: string;
}
