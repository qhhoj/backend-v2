import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../problems/dto/problem-params.dto';
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
}
