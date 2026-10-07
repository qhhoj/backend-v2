import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  CommentIdParamDto,
  CommentPageParamsDto,
} from '../core/dto/comment-params.dto';
import type { CommentDetailResponse } from '../core/dto/comment.response';
import { CommentModerationService } from './comment-moderation.service';
import type { CommentVoteEntryResponse } from './dto/comment-vote-entry.response';
import { HideCommentDto } from './dto/hide.dto';

@RequirePermission('judge.change_comment')
@Controller('api/internal/comments')
export class CommentModerationController {
  constructor(private readonly moderation: CommentModerationService) {}

  @Post(':id/hidden')
  @HttpCode(200)
  setHidden(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body() { hidden }: HideCommentDto,
  ): Promise<CommentDetailResponse> {
    return this.moderation.setHidden(auth.principal, id, hidden);
  }

  @Get(':id/votes')
  votes(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
  ): Promise<CommentVoteEntryResponse[]> {
    return this.moderation.votesOf(auth.principal, id);
  }

  @Put('pages/:type/:key/lock')
  @HttpCode(204)
  lock(
    @CurrentAuth() auth: AuthContext,
    @Param() { type, key }: CommentPageParamsDto,
  ): Promise<void> {
    return this.moderation.setLocked(auth.principal, type, key, true);
  }

  @Delete('pages/:type/:key/lock')
  @HttpCode(204)
  unlock(
    @CurrentAuth() auth: AuthContext,
    @Param() { type, key }: CommentPageParamsDto,
  ): Promise<void> {
    return this.moderation.setLocked(auth.principal, type, key, false);
  }
}
