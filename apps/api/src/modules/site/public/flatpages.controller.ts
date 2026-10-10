import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { FlatpageResponse } from './dto/flatpage.response';
import { FlatpagesService } from './flatpages.service';

@Public()
@ApiTags('Home & site')
@Controller('api/internal/pages')
export class FlatpagesController {
  constructor(private readonly pages: FlatpagesService) {}

  /**
   * Read a site page by URL
   *
   * @remarks
   * Public. Returns a static page (for example `/about`) found by the path after `/pages/`, nested paths included; the path is normalised. Pages marked `registrationRequired` need a signed-in caller. Errors: 404 `not_found`, 401 `unauthorized`. Not shared-cacheable (`private, no-cache`) because the answer depends on the session.
   */
  @ApiParam({
    name: 'path',
    type: String,
    description: 'Everything after /pages/',
  })
  @Header('Cache-Control', 'private, no-cache')
  @Get('*')
  page(
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ): Promise<FlatpageResponse> {
    const { '*': rawUrl = '' } = request.params as Record<string, string>;
    return this.pages.page(optionalPrincipal(auth), rawUrl);
  }
}
