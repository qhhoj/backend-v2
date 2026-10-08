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

@Controller('api/internal/contests/:key/announcements')
export class ContestAnnouncementsController {
  constructor(private readonly announcements: ContestAnnouncementsService) {}

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

  @Post()
  create(
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: CreateAnnouncementDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AnnouncementResponse> {
    return this.announcements.create(auth.principal, key, dto);
  }

  @Post(':id/resend')
  @HttpCode(204)
  resend(
    @Param() { key, id }: AnnouncementIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.announcements.resend(auth.principal, key, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param() { key, id }: AnnouncementIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.announcements.remove(auth.principal, key, id);
  }
}
