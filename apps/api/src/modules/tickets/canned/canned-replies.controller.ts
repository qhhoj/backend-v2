import { ApiTags } from '@nestjs/swagger';
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
@ApiTags('Tickets')
@Controller('api/internal/ticket-canned-replies')
@RequirePermission('judge.change_ticket')
export class CannedRepliesController {
  constructor(private readonly replies: CannedRepliesService) {}

  /**
   * List canned ticket replies
   *
   * @remarks
   * Requires `judge.change_ticket`. Returns the staff's stored reply templates
   * in their order. Paged with `page`.
   */
  @ApiPaginatedResponse(CannedReplyResponse)
  @Get()
  list(
    @Query() query: CannedReplyPageQueryDto,
  ): Promise<Paginated<CannedReplyResponse>> {
    return this.replies.list(query);
  }

  /**
   * Create a canned reply
   *
   * @remarks
   * Requires `judge.change_ticket`. Adds a reply template with a title, body
   * and optional order (default last). Fails with 409 `conflict` when the
   * maximum number of canned replies exists.
   */
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new RefuseNullFieldsPipe()) body: CreateCannedReplyDto,
  ): Promise<CannedReplyResponse> {
    return this.replies.create(auth.principal.userId, body);
  }

  /**
   * Update a canned reply
   *
   * @remarks
   * Requires `judge.change_ticket`. Changes the fields sent; null is refused.
   * Fails with 404 `not_found` for an unknown id.
   */
  @Patch(':id')
  update(
    @Param() { id }: CannedReplyIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateCannedReplyDto,
  ): Promise<CannedReplyResponse> {
    return this.replies.update(id, body);
  }

  /**
   * Delete a canned reply
   *
   * @remarks
   * Requires `judge.change_ticket`. Deletes the template and returns 204, or
   * 404 `not_found` for an unknown id.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { id }: CannedReplyIdParamDto): Promise<void> {
    return this.replies.remove(id);
  }
}
