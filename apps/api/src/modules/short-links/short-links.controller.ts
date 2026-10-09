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
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  CreateShortLinkDto,
  ShortCodeParamDto,
  ShortLinkListQueryDto,
} from './dto/short-link.dto';
import { ShortLinkResponse } from './dto/short-link.response';
import { ShortLinksService } from './short-links.service';

@Controller('api/internal/short-links')
export class ShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateShortLinkDto,
  ): Promise<ShortLinkResponse> {
    return this.links.create(auth.principal, body);
  }

  @ApiPaginatedResponse(ShortLinkResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ShortLinkListQueryDto,
  ): Promise<Paginated<ShortLinkResponse>> {
    return this.links.list(auth.principal, query);
  }

  @RequirePermission('judge.manage_short_link')
  @Delete(':code')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShortCodeParamDto,
  ): Promise<void> {
    return this.links.remove(auth.principal, code);
  }
}
