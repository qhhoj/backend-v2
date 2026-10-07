import { uuidStr } from '@libs/database';
import type { BlogPost } from '@libs/database';
import type { VoteScore } from '@libs/community';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class PostListItemResponse {
  id!: string;
  title!: string;
  slug!: string;
  authors!: UserSummaryResponse[];
  sticky!: boolean;
  globalPost!: boolean;
  visible!: boolean;
  publishOn!: Date;
  /** The summary, else the content (legacy list rendering). */
  summaryHtml!: string;
  score!: number;
  viewerVote!: VoteScore;

  static from(
    post: BlogPost,
    authors: UserSummaryResponse[],
    viewerVote: VoteScore,
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
    };
  }
}

export class PostDetailResponse extends PostListItemResponse {
  contentHtml!: string;
  ogImage!: string;
  organization!: OrganizationSummaryResponse | null;
  canEdit!: boolean;
  canDelete!: boolean;
  /** Markdown sources for the edit form: editors only. */
  content!: string | null;
  summary!: string | null;
}
