import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
} from '../core/dto/comment-params.dto';
import type { CommentResponse } from '../core/dto/comment.response';
import { CommentPostingService } from './comment-posting.service';
import { CommentBodyDto, NewCommentDto } from './dto/comment-body.dto';
import type { CommentRevisionResponse } from './dto/comment-revision.response';

@Controller('api/internal/comments')
export class CommentPostingController {
  constructor(private readonly posting: CommentPostingService) {}

  @Post('pages/:type/:key')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { type, key }: CommentPageParamsDto,
    @Body() body: NewCommentDto,
  ): Promise<CommentResponse> {
    return this.posting.create(auth.principal, type, key, body);
  }

  @Patch(':id')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body(new RefuseNullFieldsPipe()) { body }: CommentBodyDto,
  ): Promise<CommentResponse> {
    return this.posting.edit(auth.principal, id, body);
  }

  @Public()
  @Get(':id/revisions')
  revisions(
    @CurrentAuth() auth: AuthContext | undefined,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentRevisionResponse[]> {
    return this.posting.revisionsOf(optionalPrincipal(auth), id);
  }
}
