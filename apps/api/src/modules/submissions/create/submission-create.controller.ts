import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../../problems/core/dto/problem-params.dto';
import { SubmitDto } from './dto/submit.dto';
import { SubmitResponse } from './dto/submit.response';
import { SubmissionCreateService } from './submission-create.service';

@Controller('api/internal/problems')
export class SubmissionCreateController {
  constructor(private readonly creation: SubmissionCreateService) {}

  @Post(':code/submit')
  submit(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() dto: SubmitDto,
  ): Promise<SubmitResponse> {
    return this.creation.submit(auth, code, dto);
  }

  /** Multipart: `language`, optional `judgeId`, and one `file` (file-only languages). */
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
