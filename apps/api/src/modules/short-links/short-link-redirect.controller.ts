import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { ShortCodeParamDto } from './dto/short-link.dto';
import { ShortLinksService } from './short-links.service';

/** Mounted at the site root (`/s/:code`, an nginx location proxies it to the api); public, uncacheable, and always a relative `Location`. */
@Public()
@Controller('s')
export class ShortLinkRedirectController {
  constructor(private readonly links: ShortLinksService) {}

  /** A `@Res()` handler returns no body: the 302 is documented by hand. The error envelope is the global `default` response, nothing per route. This route is not added to `UNDOCUMENTED_BODY`. */
  @ApiResponse({ status: 302, description: 'Redirect to the stored site path' })
  @Get(':code')
  async go(
    @Param() { code }: ShortCodeParamDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const path = await this.links.resolve(code, { ip: request.ip });
    reply.header('Cache-Control', 'no-store').redirect(path, 302);
  }
}
