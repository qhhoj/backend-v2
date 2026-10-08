import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { ContestActionsService } from './contest-actions.service';
import { ContestEditingService } from './contest-editing.service';
import { ContestActionsResponse } from './dto/contest-actions.response';
import { ContestDetailResponse } from '../core/dto/contest-detail.response';
import { CloneContestDto } from './dto/contest-clone.dto';
import {
  CreateContestDto,
  NULLABLE_CONTEST_FIELDS,
  UpdateContestDto,
} from './dto/contest-edit.dto';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';

@Controller('api/internal/contests')
export class ContestEditingController {
  constructor(
    private readonly editing: ContestEditingService,
    private readonly actionStatus: ContestActionsService,
  ) {}

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
    @Body(new RefuseNullFieldsPipe(NULLABLE_CONTEST_FIELDS))
    dto: UpdateContestDto,
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

  @Get(':key/actions')
  actions(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestActionsResponse> {
    return this.actionStatus.status(auth.principal, key);
  }
}
