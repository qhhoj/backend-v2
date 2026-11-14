import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { ShareCodeParamDto } from '../core/dto/share-params.dto';
import { ShareViewResponse } from './dto/share-view.response';
import { ShareReadService } from './share-read.service';

/** Unlisted, not secret from crawlers that find the link: they must not index it. */
const NOINDEX = 'noindex, nofollow';

const textFile = (description: string) =>
  ApiOkResponse({
    description,
    content: { 'text/plain': { schema: { type: 'string' } } },
  });

/** Public: anyone with the link reads it, signed in or not. */
@Public()
@ApiTags('Shares')
@Controller('api/internal/shares')
export class ShareReadController {
  constructor(private readonly reading: ShareReadService) {}

  /**
   * Read a shared link
   *
   * @remarks
   * Public, `X-Robots-Tag: noindex, nofollow`. The page of `/c/<code>`: source, language, author, expiry, the frozen copy of a submission share, and the problem's code and name only when the viewer may see the problem. 404 `not_found` (never cached) for an unknown, expired or taken-down code and for a banned, deactivated or deleted author. A submission share is checked again on every read: 403 `contest_running` while a contest that lists its problem is running, not started, frozen or has a hidden board, 403 `hidden` when a signed-out visitor can no longer see the problem (hidden, organization-private or deleted) or the setter now shows sources to owners and testers only. The owner passes these with `hiddenReason` set; staff with `judge.manage_share` pass every rule. 120 reads per minute per address, and per user as well when signed in (429 `rate_limited`).
   */
  @Get(':code')
  view(
    @Param() { code }: ShareCodeParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ShareViewResponse> {
    reply.header('X-Robots-Tag', NOINDEX);
    return this.reading.view(optionalPrincipal(auth), code, request.ip);
  }

  /**
   * Show a shared link's code as plain text
   *
   * @remarks
   * Same rules, errors and limit as reading the link. Answers `text/plain; charset=utf-8` with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`.
   */
  @RawResponse()
  @textFile('The code, shown inline.')
  @Get(':code/raw')
  raw(
    @Param() { code }: ShareCodeParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send({ code, auth, request, reply }, 'inline');
  }

  /**
   * Download a shared link's code
   *
   * @remarks
   * Same as the raw form, with `Content-Disposition: attachment` and the filename `<code>.<language extension>` (`Main.java` for Java).
   */
  @RawResponse()
  @textFile('The code, as an attachment.')
  @Get(':code/download')
  download(
    @Param() { code }: ShareCodeParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send({ code, auth, request, reply }, 'attachment');
  }

  private async send(
    {
      code,
      auth,
      request,
      reply,
    }: {
      code: string;
      auth: AuthContext | undefined;
      request: FastifyRequest;
      reply: FastifyReply;
    },
    disposition: 'inline' | 'attachment',
  ): Promise<string> {
    const { filename, text } = await this.reading.file(
      optionalPrincipal(auth),
      code,
      request.ip,
    );
    reply
      .type('text/plain; charset=utf-8')
      .header('Content-Disposition', `${disposition}; filename="${filename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .header('X-Robots-Tag', NOINDEX)
      .header('Cache-Control', 'private, no-store');
    return text;
  }
}
