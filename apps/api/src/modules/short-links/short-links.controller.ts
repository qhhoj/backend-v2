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
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  CreateShortLinkDto,
  ShortCodeParamDto,
  ShortLinkListQueryDto,
} from './dto/short-link.dto';
import {
  CreatedShortLinkResponse,
  ShortLinkResponse,
} from './dto/short-link.response';
import { ShortLinksService } from './short-links.service';

@ApiTags('Short links')
@Controller('api/internal/short-links')
export class ShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  /**
   * Create a short link
   *
   * @remarks
   * Signed-in callers only. Shortens a site path to `/s/<code>`; only problems, contests (and their announcements, submissions, stats and ranking tabs), blog posts, users and organizations are allowed, otherwise 400 `validation_failed` on `path`. Without `code` and `expiresAt` the link is automatic and idempotent: the same path always returns the same link, and users get 20 new links per day (429 `rate_limited`).
   * Choosing a `code` or an `expiresAt` needs `judge.manage_short_link` (403 `forbidden` otherwise), and staff have no daily quota. A taken code gives 409 `conflict`; a reserved code or a past expiry gives 400. The answer carries the link without its visit stats; the list has them.
   */
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateShortLinkDto,
  ): Promise<CreatedShortLinkResponse> {
    return this.links.create(auth.principal, body);
  }

  /**
   * List short links
   *
   * @remarks
   * Signed-in callers only. Returns the caller's own links, newest first. `scope=all` lists every link and needs `judge.manage_short_link` (403 `forbidden`). Includes hit counts and expiry.
   */
  @ApiPaginatedResponse(ShortLinkResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ShortLinkListQueryDto,
  ): Promise<Paginated<ShortLinkResponse>> {
    return this.links.list(auth.principal, query);
  }

  /**
   * Delete a short link
   *
   * @remarks
   * Requires `judge.manage_short_link`. Removes the link by code; the deletion is written to the server log. 404 `not_found`. Returns 204.
   */
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
