import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { SubmissionIdParamDto } from './dto/submission-params.dto';
import { SubmissionsService } from './submissions.service';

const textFile = (description: string) =>
  ApiOkResponse({
    description,
    content: { 'text/plain': { schema: { type: 'string' } } },
  });

/** Plain links (cookie session), so the browser opens or saves the file itself; the text is never rendered as a page. */
@ApiTags('Submissions')
@Controller('api/internal/submissions')
export class SubmissionSourceFileController {
  constructor(private readonly submissions: SubmissionsService) {}

  /**
   * Show the source code as plain text
   *
   * @remarks
   * Needs a signed-in user and follows the same access rules and errors as the
   * source endpoint. Answers `text/plain; charset=utf-8` with
   * `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and
   * `Cache-Control: private, no-store`. 404
   * `not_found` for a file-only language, which has no source text.
   */
  @RawResponse()
  @textFile('The source text, shown inline.')
  @Get(':id/source/raw')
  raw(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send(auth, id, reply, 'inline');
  }

  /**
   * Download the source code as a file
   *
   * @remarks
   * Same access rules, errors and body as the raw endpoint, but answers
   * `Content-Disposition: attachment` with the filename `<submission id>.<language
   * extension>` (`Main.java` for Java).
   */
  @RawResponse()
  @textFile('The source text, as an attachment.')
  @Get(':id/source/download')
  download(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send(auth, id, reply, 'attachment');
  }

  private async send(
    auth: AuthContext,
    id: string,
    reply: FastifyReply,
    disposition: 'inline' | 'attachment',
  ): Promise<string> {
    const { filename, text } = await this.submissions.sourceFile(
      auth.principal,
      id,
    );
    reply
      .type('text/plain; charset=utf-8')
      .header('Content-Disposition', `${disposition}; filename="${filename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return text;
  }
}
