import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { BLOG_PAGE_SIZE } from '@libs/community';
import type { VoteScore } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { BlogPost } from '@libs/database';
import type { FilterQuery, SortOrder } from 'mongoose';
import { CommentsRepository } from '../../comments/core/comments.repository';
import { VotesRepository } from '../../contributions/votes.repository';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { BlogAccess } from './blog-access';
import { BlogPostsRepository } from './blog-posts.repository';
import { BlogVisibilityService } from './blog-visibility.service';
import type { PostListQueryDto } from './dto/post-list.dto';
import { PostDetailResponse, PostListItemResponse } from './dto/post.response';

const NEWEST: Record<string, SortOrder> = { publishOn: -1, _id: -1 };
const STICKY_FIRST: Record<string, SortOrder> = {
  sticky: -1,
  publishOn: -1,
  _id: -1,
};

@Injectable()
export class BlogPostsService {
  constructor(
    private readonly posts: BlogPostsRepository,
    private readonly visibility: BlogVisibilityService,
    private readonly votes: VotesRepository,
    private readonly users: UsersRepository,
    private readonly organizations: OrganizationsService,
    private readonly comments: CommentsRepository,
  ) {}

  /** Legacy `PostList` (organization posts never appear here). */
  list(
    principal: Principal | null,
    query: PostListQueryDto,
    now = new Date(),
  ): Promise<Paginated<PostListItemResponse>> {
    const global = query.feed === 'global';
    return this.pageOf(
      principal,
      {
        ...BlogAccess.publishedPersonalFilter(now),
        ...(global ? { globalPost: true } : {}),
      },
      global ? STICKY_FIRST : NEWEST,
      query.page,
    );
  }

  async detail(
    principal: Principal | null,
    id: string,
  ): Promise<PostDetailResponse> {
    const { post, view, organization } = await this.visibility.visiblePost(
      principal,
      id,
    );
    const [item] = await this.items(principal, [post]);
    const canEdit = BlogAccess.canEdit(principal, view);
    return {
      ...item,
      contentHtml: post.contentHtml,
      ogImage: post.ogImage,
      organization: organization
        ? OrganizationSummaryResponse.from(organization)
        : null,
      canEdit,
      canDelete: BlogAccess.canDelete(principal, view),
      content: canEdit ? post.content : null,
      summary: canEdit ? post.summary : null,
    };
  }

  /** Legacy `UserBlogPage`. */
  async userPosts(
    principal: Principal | null,
    username: string,
    page: number,
    now = new Date(),
  ): Promise<Paginated<PostListItemResponse>> {
    const author = await this.users.findByUsername(username, { _id: 1 });
    if (!author) throw new AppError('not_found', 404, 'No such user');
    return this.pageOf(
      principal,
      BlogAccess.authorTabFilter(principal, author._id, now),
      STICKY_FIRST,
      page,
    );
  }

  /** Legacy `OrganizationHome` posts: an empty list for viewers who see none. */
  async organizationPosts(
    principal: Principal | null,
    slug: string,
    page: number,
    now = new Date(),
  ): Promise<Paginated<PostListItemResponse>> {
    const organization = await this.organizations.bySlug(slug);
    const filter = BlogAccess.organizationFilter(
      principal,
      OrganizationAccess.accessView(organization),
      now,
    );
    return filter
      ? this.pageOf(principal, filter, STICKY_FIRST, page)
      : new Paginated([], { page, pageSize: BLOG_PAGE_SIZE, total: 0 });
  }

  private async pageOf(
    principal: Principal | null,
    filter: FilterQuery<BlogPost>,
    sort: Record<string, SortOrder>,
    page: number,
  ): Promise<Paginated<PostListItemResponse>> {
    const { items, total } = await this.posts.page(
      filter,
      sort,
      page,
      BLOG_PAGE_SIZE,
    );
    return new Paginated(await this.items(principal, items), {
      page,
      pageSize: BLOG_PAGE_SIZE,
      total,
    });
  }

  /** Authors in one read, the viewer's votes and the comment counts in one indexed read each. */
  async items(
    principal: Principal | null,
    posts: readonly BlogPost[],
  ): Promise<PostListItemResponse[]> {
    const ids = posts.map((post) => uuidStr(post._id));
    const [authors, viewerVotes, commentCounts] = await Promise.all([
      this.users.findByIds(
        unique(posts.flatMap((post) => post.authors.map(uuidStr))),
      ),
      principal
        ? this.votes.viewerVotes('blog', ids, principal.userId)
        : Promise.resolve(new Map<string, VoteScore>()),
      this.comments.countVisible('blog', ids),
    ]);
    const authorOf = new Map(
      authors.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
    return posts.map((post) =>
      PostListItemResponse.from(
        post,
        post.authors
          .map(uuidStr)
          .flatMap((authorId) => authorOf.get(authorId) ?? []),
        viewerVotes.get(uuidStr(post._id)) ?? 0,
        commentCounts.get(uuidStr(post._id)) ?? 0,
      ),
    );
  }
}
