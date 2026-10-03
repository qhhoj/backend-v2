import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { ProblemDetailResponse } from './dto/problem-detail.response';
import { ProblemEditingService } from './problem-editing.service';

@Controller('api/internal/problems')
export class ProblemEditingController {
  constructor(private readonly editing: ProblemEditingService) {}

  @RequirePermission('judge.add_problem')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.create(auth, body, 'create');
  }

  @RequirePermission('judge.suggest_new_problem')
  @Post('suggest')
  suggest(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.create(auth, body, 'suggest');
  }

  @Patch(':code')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Body() body: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.edit(auth, code, body);
  }
}
