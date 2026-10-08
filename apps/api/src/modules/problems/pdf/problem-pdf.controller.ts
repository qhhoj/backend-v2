import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ErrorResponse } from '@libs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  ProblemCodeParamDto,
  StatementLangQueryDto,
} from '../core/dto/problem-params.dto';
import { PdfRenderingResponse } from './dto/pdf-rendering.response';
import { ProblemPdfService } from './problem-pdf.service';

/** Poll interval the frontend button waits between requests while rendering. */
const RENDERING_RETRY_AFTER_SECONDS = 3;

@Controller('api/internal/problems')
export class ProblemPdfController {
  constructor(private readonly pdfs: ProblemPdfService) {}

  /**
   * Outcomes, documented here because the plain `@Res()` hides them from the plugin:
   * 200 the PDF (`application/pdf`, inline); 202 `{ data: { status: 'rendering' } }` with `Retry-After` while the render is pending, poll the same URL;
   * 503 `pdf_unavailable` with `Retry-After` when the render failed; 404 when the problem is not visible.
   */
  // The 202 below spells out its `{ data }` envelope itself.
  @ApiExtension('x-enveloped', true)
  @ApiExtraModels(PdfRenderingResponse)
  @ApiResponse({
    status: 200,
    description: 'The PDF.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Rendering; poll the same URL (see Retry-After).',
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: getSchemaPath(PdfRenderingResponse) } },
    },
  })
  @ApiResponse({
    status: 503,
    description:
      'The render failed (`pdf_unavailable`); retry after Retry-After.',
    type: ErrorResponse,
  })
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
      { code, requestedLang: lang, ip: request.ip },
      { shouldEnqueue: request.method !== 'HEAD' },
    );
    if (location.status === 'rendering')
      return reply
        .code(202)
        .header('Retry-After', String(RENDERING_RETRY_AFTER_SECONDS))
        .header('Cache-Control', 'no-store')
        .send({ data: { status: 'rendering' } });
    const { file, filename } = location;
    try {
      const { size } = await file.stat();
      return reply
        .type('application/pdf')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .header('Content-Length', size)
        .send(file.createReadStream());
    } catch (error) {
      await file.close();
      throw error;
    }
  }
}
