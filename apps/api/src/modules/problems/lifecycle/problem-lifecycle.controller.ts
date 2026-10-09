import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { DeletedListQueryDto } from './dto/deleted-list.dto';
import { DeletedProblemResponse } from './dto/deleted-problem.response';
import { PurgeQueuedResponse } from './dto/purge-queued.response';
import { withIssues } from './lifecycle-refusals';
import { ProblemLifecycleService } from './problem-lifecycle.service';

/** `deleted` is a reserved problem code, so the static `GET /problems/deleted` never meets a problem. */
@Controller('api/internal/problems')
export class ProblemLifecycleController {
  constructor(private readonly lifecycle: ProblemLifecycleService) {}

  @RequirePermission('judge.delete_problem')
  @ApiPaginatedResponse(DeletedProblemResponse)
  @Get('deleted')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: DeletedListQueryDto,
  ): Promise<Paginated<DeletedProblemResponse>> {
    return withIssues(() => this.lifecycle.list(auth.principal, query));
  }

  @RequirePermission('judge.delete_problem')
  @Delete(':code')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() { confirmCode }: ConfirmCodeDto,
  ): Promise<void> {
    return withIssues(() => this.lifecycle.remove(auth, code, confirmCode));
  }

  @RequirePermission('judge.delete_problem')
  @Post(':code/restore')
  @HttpCode(204)
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<void> {
    return withIssues(() => this.lifecycle.restore(auth, code));
  }

  @RequirePermission('judge.delete_problem')
  @Post(':code/purge-now')
  @HttpCode(202)
  purgeNow(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() { confirmCode }: ConfirmCodeDto,
  ): Promise<PurgeQueuedResponse> {
    return withIssues(() => this.lifecycle.purgeNow(auth, code, confirmCode));
  }
}
