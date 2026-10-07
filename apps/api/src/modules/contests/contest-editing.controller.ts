import { Body, Controller, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestEditingService } from './contest-editing.service';
import { ContestDetailResponse } from './dto/contest-detail.response';
import { CloneContestDto } from './dto/contest-clone.dto';
import { CreateContestDto, UpdateContestDto } from './dto/contest-edit.dto';
import { ContestKeyParamDto } from './dto/contest-params.dto';
import { QueuedResponse } from './dto/queued.response';

@Controller('api/internal/contests')
export class ContestEditingController {
  constructor(private readonly editing: ContestEditingService) {}

  @RequirePermission('judge.add_contest')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateContestDto,
  ): Promise<ContestDetailResponse> {
    return this.editing.create(auth.principal, dto);
  }

  @Patch(':key')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: UpdateContestDto,
  ): Promise<ContestDetailResponse> {
    return this.editing.update(auth.principal, key, dto);
  }

  @RequirePermission('judge.clone_contest')
  @Post(':key/clone')
  clone(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() { key: newKey }: CloneContestDto,
  ): Promise<ContestDetailResponse> {
    return this.editing.clone(auth.principal, key, newKey);
  }

  @Post(':key/rescore')
  @HttpCode(202)
  rescore(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.editing.rescore(auth.principal, key);
  }

  @Post(':key/judge-final')
  @HttpCode(202)
  judgeFinal(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.editing.judgeFinal(auth.principal, key);
  }
}
