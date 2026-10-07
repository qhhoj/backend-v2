import { CommentPageLinkResponse, CommentResponse } from './comment.response';

export class RecentCommentResponse extends CommentResponse {
  page!: CommentPageLinkResponse;
}
