import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, escapeRegExp, Paginated } from '@libs/common';
import { excerpt } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Comment } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import type { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { CommentsRepository } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import { CommentPageLinkResponse } from '../core/dto/comment.response';
import type {
  AdminCommentItemResponse,
  AdminCommentQueryDto,
  AdminCommentState,
} from './dto/admin-comment.dto';

export const ADMIN_COMMENTS_PAGE_SIZE = 30;
const EXCERPT_LENGTH = 200;
/** Mongo's `MaxTimeMSExpired`. */
const MAX_TIME_EXPIRED = 50;

const STATE_FILTER: Record<AdminCommentState, FilterQuery<Comment>> = {
  all: { hidden: { $in: [false, true] } },
  visible: { hidden: false },
  hidden: { hidden: true },
};

/** Legacy `CommentAdmin` list (search by body or author, filter hidden): every comment of the site for `judge.change_comment`, newest first. Comments on pages the moderator cannot read are left out of the page (still counted in `total`), like the report queue. */
@Injectable()
export class CommentAdminService {
  constructor(
    private readonly comments: CommentsService,
    private readonly rows: CommentsRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(
    principal: Principal,
    query: AdminCommentQueryDto,
  ): Promise<Paginated<AdminCommentItemResponse>> {
    this.comments.assertOpen(principal);
    const meta = { page: query.page, pageSize: ADMIN_COMMENTS_PAGE_SIZE };
    const filter = await this.filterOf(query);
    if (!filter) return new Paginated([], { ...meta, total: 0 });
    const { items, total } = await this.matching(filter, query.page);
    return new Paginated(await this.present(principal, items), {
      ...meta,
      total,
    });
  }

  /** Null when the named author does not exist (nothing can match). */
  private async filterOf({
    search,
    author,
    state,
    pageType,
  }: AdminCommentQueryDto): Promise<FilterQuery<Comment> | null> {
    const filter: FilterQuery<Comment> = { ...STATE_FILTER[state] };
    if (author?.trim()) {
      const user = await this.users.findByUsername(author.trim(), { _id: 1 });
      if (!user) return null;
      filter.author = user._id;
    }
    if (pageType) filter['page.type'] = pageType;
    if (search?.trim()) {
      filter.body = { $regex: escapeRegExp(search.trim()), $options: 'i' };
      filter.deletedAt = null;
    }
    return filter;
  }

  private async matching(filter: FilterQuery<Comment>, page: number) {
    try {
      return await this.rows.newestMatching(
        filter,
        page,
        ADMIN_COMMENTS_PAGE_SIZE,
      );
    } catch (error) {
      if ((error as { code?: number }).code === MAX_TIME_EXPIRED)
        throw new AppError(
          'search_too_broad',
          422,
          'The search took too long; add an author or a page type',
        );
      throw error;
    }
  }

  private async present(
    principal: Principal,
    items: readonly Comment[],
  ): Promise<AdminCommentItemResponse[]> {
    const [readable, summaryOf] = await Promise.all([
      this.comments.readablePagesOf(principal, items),
      this.comments.summariesOf(
        items.flatMap((row) =>
          row.hiddenByUser ? [row.author, row.hiddenByUser] : [row.author],
        ),
      ),
    ]);
    return items.flatMap((row) => {
      const pageInfo = readable.get(uuidStr(row._id));
      return pageInfo
        ? [this.item(row, CommentPageLinkResponse.from(pageInfo), summaryOf)]
        : [];
    });
  }

  private item(
    row: Comment,
    page: CommentPageLinkResponse,
    summaryOf: ReadonlyMap<string, UserSummaryResponse>,
  ): AdminCommentItemResponse {
    const deleted = Boolean(row.deletedAt);
    const summary = (id: unknown) =>
      id ? (summaryOf.get(uuidStr(id)) ?? null) : null;
    return {
      comment: {
        id: uuidStr(row._id),
        excerpt: deleted ? '' : excerpt(row.body, EXCERPT_LENGTH),
        author: summary(row.author),
        hidden: row.hidden,
        deleted,
      },
      page,
      createdAt: row.createdAt,
      hiddenBy: row.hidden ? summary(row.hiddenByUser) : null,
    };
  }
}
