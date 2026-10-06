import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { BulkRejudgeDto, BulkRejudgeResponse } from './dto/bulk-rejudge.dto';
import { SubmissionIdParamDto } from './dto/submission-params.dto';
import { SubmissionActionsService } from './submission-actions.service';

@Controller('api/internal/submissions')
export class SubmissionActionsController {
  constructor(private readonly actions: SubmissionActionsService) {}

  @Post('rejudge')
  @HttpCode(200)
  bulkRejudge(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: BulkRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    return this.actions.bulkRejudge(auth.principal, dto);
  }

  @Post(':id/abort')
  @HttpCode(204)
  abort(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.abort(auth.principal, id);
  }

  @Post(':id/rejudge')
  @HttpCode(204)
  rejudge(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.rejudge(auth.principal, id);
  }

  @Post(':id/reject')
  @HttpCode(204)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.reject(auth.principal, id);
  }
}
