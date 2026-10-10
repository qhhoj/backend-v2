import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ErrorResponse } from '@libs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  ApiTags,
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

@ApiTags('Problems')
@Controller('api/internal/problems')
export class ProblemPdfController {
  constructor(private readonly pdfs: ProblemPdfService) {}

  /**
   * Download the problem statement as a PDF
   *
   * @remarks
   * Public for problems the viewer may see. The PDF is rendered by a background
   * job and cached per problem and language: 200 returns the file inline
   * (`application/pdf`); 202 `{ data: { status: 'rendering' } }` with
   * `Retry-After` means the render is pending, so poll the same URL; 503
   * `pdf_unavailable` with `Retry-After` means the last render failed. `lang`
   * picks the statement language (falling back to the base one). Starting a
   * render is limited to 30 per minute per client IP, `HEAD` requests never
   * start one, and polling a pending render is free. Unknown or invisible
   * problems are 404 `not_found`.
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
  // Plain `@Res()`: Nest's `reply()` applies the route's status (200) after a passthrough handler, which would clobber the 202; exceptions thrown before `send` still reach the filter.
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
