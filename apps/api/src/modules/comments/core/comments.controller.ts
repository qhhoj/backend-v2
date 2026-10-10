import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CommentsService } from './comments.service';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
  CommentPageQueryDto,
} from './dto/comment-params.dto';
import type {
  CommentDetailResponse,
  CommentPageResponse,
} from './dto/comment.response';

@Public()
@ApiTags('Comments')
@Controller('api/internal/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /**
   * List the comments of a page
   *
   * @remarks
   * Public. Returns one page of threads (20 top-level comments with all their
   * replies) of a commentable page, addressed by `type` (problem, editorial,
   * contest, blog or tagProblem) and its natural `key` (problem code, contest
   * key, post id). Also reports whether the page is locked and whether the
   * viewer can comment. Hidden comments are not returned. Fails with 404
   * `not_found` when the page is unknown or unreadable, and 403 `forbidden`
   * while an official contest closes comments. Contest problem threads are
   * empty for contestants who are in the contest.
   */
  @Get('pages/:type/:key')
  page(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { type, key }: CommentPageParamsDto,
    @Query() { page }: CommentPageQueryDto,
  ): Promise<CommentPageResponse> {
    return this.comments.page(optionalPrincipal(auth), type, key, page);
  }

  /**
   * Get a comment
   *
   * @remarks
   * Public. Returns one comment with the link to its page. Hidden comments are
   * only returned to holders of `judge.change_comment`. Fails with 404
   * `not_found` for malformed, unknown, hidden or unreadable comments.
   */
  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentDetailResponse> {
    return this.comments.detail(optionalPrincipal(auth), id);
  }
}
