import { ApiProperty } from '@nestjs/swagger';
import { uuidStr } from '@libs/database';
import type { BlogPost } from '@libs/database';
import { VOTE_SCORES } from '@libs/community';
import type { VoteScore } from '@libs/community';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class PostListItemResponse {
  /** Id of the post. */
  id!: string;
  /** Post title. */
  title!: string;
  /** URL-friendly name derived from the author or organization. */
  slug!: string;
  /** The post's authors. */
  authors!: UserSummaryResponse[];
  /** Pinned to the top of lists. */
  sticky!: boolean;
  /** Shown in the global newsfeed. */
  globalPost!: boolean;
  /** False for a draft. */
  visible!: boolean;
  /** When the post is or becomes public, ISO 8601. */
  publishOn!: Date;
  /** The summary, else the content (legacy list rendering). */
  summaryHtml!: string;
  /** Sum of the votes. */
  score!: number;
  /** The caller's vote: 1, -1 or 0. */
  @ApiProperty({ enum: VOTE_SCORES, enumName: 'VoteScore' })
  viewerVote!: VoteScore;
  /** Visible comments. */
  commentCount!: number;

  static from(
    post: BlogPost,
    authors: UserSummaryResponse[],
    viewerVote: VoteScore,
    commentCount: number,
  ): PostListItemResponse {
    return {
      id: uuidStr(post._id),
      title: post.title,
      slug: post.slug,
      authors,
      sticky: post.sticky,
      globalPost: post.globalPost,
      visible: post.visible,
      publishOn: post.publishOn,
      summaryHtml: post.summaryHtml || post.contentHtml,
      score: post.score,
      viewerVote,
      commentCount,
    };
  }
}

export class PostDetailResponse extends PostListItemResponse {
  /** The post rendered to HTML. */
  contentHtml!: string;
  /** Image URL or site path used for link previews; empty for none. */
  ogImage!: string;
  /** The organization the post was written for; null for a personal post. */
  organization!: OrganizationSummaryResponse | null;
  /** The viewer may edit the post. */
  canEdit!: boolean;
  /** The viewer may delete the post. */
  canDelete!: boolean;
  /** Markdown sources for the edit form: editors only. */
  content!: string | null;
  summary!: string | null;
}
