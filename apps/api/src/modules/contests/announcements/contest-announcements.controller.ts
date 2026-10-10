import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ContestAnnouncementsService } from './contest-announcements.service';
import {
  AnnouncementIdParamDto,
  AnnouncementListQueryDto,
  CreateAnnouncementDto,
} from './dto/announcement.dto';
import { AnnouncementResponse } from './dto/announcement.response';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';

@ApiTags('Contests')
@Controller('api/internal/contests/:key/announcements')
export class ContestAnnouncementsController {
  constructor(private readonly announcements: ContestAnnouncementsService) {}

  /**
   * List the announcements of a contest
   *
   * @remarks
   * Returns the contest's announcements, rendered, one page at a time. Public
   * for any contest the viewer may see.
   */
  @Public()
  @ApiPaginatedResponse(AnnouncementResponse)
  @Get()
  list(
    @Param() { key }: ContestKeyParamDto,
    @Query() query: AnnouncementListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<AnnouncementResponse>> {
    return this.announcements.list(optionalPrincipal(auth), key, query);
  }

  /**
   * Post a contest announcement
   *
   * @remarks
   * Contest editors only. Stores the announcement (Markdown, rendered to HTML)
   * and, when the contest pushes announcements, delivers it live on the
   * contest event stream and to users' notification inboxes. Pushes are
   * limited per contest per hour (429 `rate_limited`). Fails with 400
   * `validation_failed` when the text cannot be rendered.
   */
  @Post()
  create(
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: CreateAnnouncementDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AnnouncementResponse> {
    return this.announcements.create(auth.principal, key, dto);
  }

  /**
   * Resend a contest announcement
   *
   * @remarks
   * Contest editors only. Pushes an existing announcement again to the open
   * contest streams; inboxes keep one entry per announcement, so only users
   * the first delivery missed are notified. Returns 204, or 404 `not_found`
   * for an unknown announcement.
   */
  @Post(':id/resend')
  @HttpCode(204)
  resend(
    @Param() { key, id }: AnnouncementIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.announcements.resend(auth.principal, key, id);
  }

  /**
   * Delete a contest announcement
   *
   * @remarks
   * Contest editors only. Deletes the announcement and returns 204, or 404
   * `not_found` when it does not exist in this contest.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param() { key, id }: AnnouncementIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.announcements.remove(auth.principal, key, id);
  }
}
