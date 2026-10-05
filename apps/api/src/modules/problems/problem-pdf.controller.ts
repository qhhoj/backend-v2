import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  ProblemCodeParamDto,
  StatementLangQueryDto,
} from './dto/problem-params.dto';
import { ProblemPdfService } from './problem-pdf.service';

@Controller('api/internal/problems')
export class ProblemPdfController {
  constructor(private readonly pdfs: ProblemPdfService) {}

  /** Plain `@Res()`: Nest's `reply()` applies the route's status (200) after a passthrough handler, which would clobber the 202; exceptions thrown before `send` still reach the filter. */
  @Public()
  @Get(':code/pdf')
  async pdf(
    @Param() { code }: ProblemCodeParamDto,
    @Query() { lang }: StatementLangQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const location = await this.pdfs.locate(
      optionalPrincipal(auth),
      request.ip,
      code,
      lang,
    );
    if (location.status === 'ready')
      return reply
        .type('application/pdf')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `inline; filename="${code}.${lang}.pdf"`)
        .send(createReadStream(location.path));
    return reply.code(202).send({ data: { status: 'rendering' } });
  }
}
