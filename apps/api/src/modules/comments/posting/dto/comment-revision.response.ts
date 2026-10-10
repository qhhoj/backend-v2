import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class CommentRevisionResponse {
  /** When the edit was made, ISO 8601. */
  at!: Date;
  /** Who edited; null when the account is gone. */
  editor!: UserSummaryResponse | null;
  /** Markdown before and after the edit. */
  before!: string;
  after!: string;
}
