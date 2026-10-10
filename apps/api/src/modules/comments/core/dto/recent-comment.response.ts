import { CommentPageLinkResponse, CommentResponse } from './comment.response';

export class RecentCommentResponse extends CommentResponse {
  /** The page the comment belongs to. */
  page!: CommentPageLinkResponse;
}
