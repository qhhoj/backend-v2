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
@Controller('api/internal/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('pages/:type/:key')
  page(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { type, key }: CommentPageParamsDto,
    @Query() { page }: CommentPageQueryDto,
  ): Promise<CommentPageResponse> {
    return this.comments.page(optionalPrincipal(auth), type, key, page);
  }

  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentDetailResponse> {
    return this.comments.detail(optionalPrincipal(auth), id);
  }
}
