import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { FlatpageResponse } from './dto/flatpage.response';
import { FlatpagesService } from './flatpages.service';

@Public()
@Controller('api/internal/pages')
export class FlatpagesController {
  constructor(private readonly pages: FlatpagesService) {}

  /** The wildcard (`*`) is everything after `/pages/`, nested urls included. `private, no-cache`: the body depends on the session (`registrationRequired` pages), so a shared cache must never serve it and a private one must revalidate (an edit shows at once). */
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
