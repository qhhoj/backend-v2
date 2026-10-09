import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, RefuseNullFieldsPipe } from '@libs/common';
import type { Paginated } from '@libs/common';
import { CannedRepliesService } from './canned-replies.service';
import {
  CannedReplyIdParamDto,
  CannedReplyPageQueryDto,
  CreateCannedReplyDto,
  UpdateCannedReplyDto,
} from './dto/canned-reply.dto';
import { CannedReplyResponse } from './dto/canned-reply.response';

/** Staff answers to insert into a ticket reply; managed by `change_ticket` holders only. */
@Controller('api/internal/ticket-canned-replies')
@RequirePermission('judge.change_ticket')
export class CannedRepliesController {
  constructor(private readonly replies: CannedRepliesService) {}

  @ApiPaginatedResponse(CannedReplyResponse)
  @Get()
  list(
    @Query() query: CannedReplyPageQueryDto,
  ): Promise<Paginated<CannedReplyResponse>> {
    return this.replies.list(query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new RefuseNullFieldsPipe()) body: CreateCannedReplyDto,
  ): Promise<CannedReplyResponse> {
    return this.replies.create(auth.principal.userId, body);
  }

  @Patch(':id')
  update(
    @Param() { id }: CannedReplyIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateCannedReplyDto,
  ): Promise<CannedReplyResponse> {
    return this.replies.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { id }: CannedReplyIdParamDto): Promise<void> {
    return this.replies.remove(id);
  }
}
