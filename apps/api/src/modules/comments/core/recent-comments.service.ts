import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import type { CursorPageMetaResponse } from '@libs/common';
import { officialModeLocks, pageOf, pageRef } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Comment } from '@libs/database';
import { SettingsService } from '@libs/settings';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import { CommentPagesService } from './comment-pages.service';
import type { PageInfo } from './comment-pages.service';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentPageLinkResponse } from './dto/comment.response';
import type { RecentCommentResponse } from './dto/recent-comment.response';

/** A scan never reads more than this many batches; the caller continues from `nextBefore`. */
export const RECENT_SCAN_BATCHES = 10;
/** Legacy `UserCommentPage.paginate_by`. */
export const USER_COMMENTS_PAGE_SIZE = 10;

@Injectable()
export class RecentCommentsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly comments: CommentsRepository,
    private readonly pages: CommentPagesService,
    private readonly reads: CommentsService,
    private readonly currentContest: CurrentContestService,
    private readonly users: UsersRepository,
  ) {}

  /** Legacy `get_newest_visible_comments`: newest first, only pages the viewer may read (a contestant's locked problem threads stay hidden), scanned in batches of 2 × limit with one access pass per batch and the viewer's contest scope computed once. `nextBefore` is null once nothing older is left. */
  async newest(
    principal: Principal | null,
    {
      authorId,
      before = null,
      limit,
    }: { authorId?: string; before?: string | null; limit: number },
  ): Promise<{ items: RecentCommentResponse[]; nextBefore: string | null }> {
    if (officialModeLocks(this.settings, principal))
      return { items: [], nextBefore: null };
    const now = new Date();
    const scope = principal
      ? await this.currentContest.scopeOf(principal, now)
      : null;
    const picked: Array<{ comment: Comment; pageInfo: PageInfo }> = [];
    let cursor = before;
    for (let batch = 0; batch < RECENT_SCAN_BATCHES; batch += 1) {
      const rows = await this.comments.newestVisible(
        { authorId, before: cursor },
        2 * limit,
      );
      const readable = await this.pages.accessible(
        principal,
        rows.map(pageOf),
        now,
        scope,
      );
      for (const comment of rows) {
        cursor = uuidStr(comment._id);
        const pageInfo = readable.get(pageRef(pageOf(comment)));
        if (pageInfo && !this.reads.hidesThread(principal, pageInfo))
          picked.push({ comment, pageInfo });
        if (picked.length === limit)
          return this.respond(principal, picked, cursor);
      }
      if (rows.length < 2 * limit) return this.respond(principal, picked, null);
    }
    // Scan budget spent: the caller continues from the last row read.
    return this.respond(principal, picked, cursor);
  }

  private async respond(
    principal: Principal | null,
    picked: ReadonlyArray<{ comment: Comment; pageInfo: PageInfo }>,
    nextBefore: string | null,
  ): Promise<{ items: RecentCommentResponse[]; nextBefore: string | null }> {
    const responses = await this.reads.respond(
      principal,
      picked.map(({ comment }) => comment),
    );
    return {
      items: responses.map((response, index) => ({
        ...response,
        page: CommentPageLinkResponse.from(picked[index].pageInfo),
      })),
      nextBefore,
    };
  }

  /** Legacy `UserCommentPage` (`judge.view_all_user_comment`), keyset-paged by comment id. */
  async userComments(
    principal: Principal | null,
    username: string,
    before?: string,
  ): Promise<Paginated<RecentCommentResponse, CursorPageMetaResponse>> {
    if (!principal) throw new AppError('unauthorized', 401, 'Sign in first');
    if (!hasPermission(principal, 'judge.view_all_user_comment'))
      throw new AppError('forbidden', 403, "You cannot list a user's comments");
    const author = await this.users.findByUsername(username, { _id: 1 });
    if (!author) throw new AppError('not_found', 404, 'No such user');
    const { items, nextBefore } = await this.newest(principal, {
      authorId: author._id,
      before,
      limit: USER_COMMENTS_PAGE_SIZE,
    });
    return new Paginated(items, {
      pageSize: USER_COMMENTS_PAGE_SIZE,
      nextBefore,
    });
  }
}
