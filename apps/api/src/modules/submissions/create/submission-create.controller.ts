import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { MAX_SOURCE_LENGTH } from '@libs/database';
import { windowName } from '@libs/common';
import {
  SUBMIT_LIMIT,
  SUBMIT_WINDOW_SECONDS,
  FINAL_PENDING_LIMIT,
  UNFINISHED_LIMIT,
} from '../core/rate-limits';
import { ProblemCodeParamDto } from '../../problems/core/dto/problem-params.dto';
import { SubmitDto } from './dto/submit.dto';
import { SubmitResponse } from './dto/submit.response';
import { SubmissionCreateService } from './submission-create.service';

@ApiTags('Submissions')
@Controller('api/internal/problems')
export class SubmissionCreateController {
  constructor(private readonly creation: SubmissionCreateService) {}

  @ApiOperation({
    summary: 'Submit a solution as typed source code',
    description: [
      'Needs a signed-in user who can see the problem. `language` must be one of',
      "the problem's allowed languages, active (400 `language_inactive`) and not",
      `a file-only language (400 \`language_takes_file\`); \`source\` is 1 to ${MAX_SOURCE_LENGTH} characters. \`judgeId\` pins a`,
      'judge and is for problem editors only (403 `judge_choice_forbidden`; 400',
      '`judge_unavailable` if it is offline or lacks the language). When the',
      "caller's current contest lists the problem, the submission counts as a",
      "contest submission, subject to the contest's attempt cap (403",
      '`contest_submission_limit`); a spectator who is not contest staff (author,',
      'curator, tester or contest editor) cannot submit to it until the contest',
      'ends (403 `spectator_cannot_submit`). Other errors: 403 `banned_from_problem`, 429',
      `\`rate_limited\` (${SUBMIT_LIMIT} per ${windowName(SUBMIT_WINDOW_SECONDS)} per user) and 429`,
      `\`unfinished_submission_limit\` (${UNFINISHED_LIMIT} unfinished submissions, waived by`,
      '`judge.spam_submission`; not applied in a running final-submission contest,',
      `where 429 \`final_pending_limit\` caps pending submissions at ${FINAL_PENDING_LIMIT} per problem).`,
      'Queues the submission for judging and returns its',
      '`id`.',
    ].join('\n'),
  })
  @Post(':code/submit')
  submit(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() dto: SubmitDto,
  ): Promise<SubmitResponse> {
    return this.creation.submit(auth, code, dto);
  }

  /**
   * Submit a solution as an uploaded file
   *
   * @remarks
   * Same rules and errors as the typed submission, for languages that take a
   * file (`fileOnly`); a typed-source language is 400 `language_takes_text`.
   * Send a multipart form with `language`, optional `judgeId` and one `file`
   * whose extension is the language's (400 `file_wrong_extension`) and whose
   * size is within the language's `fileSizeLimit` in MB (413 `file_too_large`;
   * 400 `file_upload_disabled` when uploads are off). The file is stored and its
   * media URL becomes the submission's source.
   */
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['language', 'file'],
      properties: {
        language: {
          type: 'string',
          format: 'uuid',
          description: "Language id; one of the problem's allowed languages.",
        },
        judgeId: {
          type: 'string',
          description: 'Judge name; problem editors only.',
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @Post(':code/submit/file')
  submitFile(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<SubmitResponse> {
    return this.creation.submitFile(auth, code, request);
  }
}
