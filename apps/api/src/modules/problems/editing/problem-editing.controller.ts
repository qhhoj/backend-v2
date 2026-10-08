import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe, RenderPreviewResponse } from '@libs/common';
import { CloneProblemDto } from './dto/clone.dto';
import { PutEditorialDto } from './dto/editorial.dto';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { RenderPreviewDto } from './dto/render-preview.dto';
import { PutTranslationDto, TranslationParamsDto } from './dto/translation.dto';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { ProblemCloneService } from './problem-clone.service';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemStatementEditingService } from './problem-statement-editing.service';

@Controller('api/internal/problems')
export class ProblemEditingController {
  constructor(
    private readonly editing: ProblemEditingService,
    private readonly statements: ProblemStatementEditingService,
    private readonly clones: ProblemCloneService,
  ) {}

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
    @Param() { code }: ProblemCodeParamDto,
    @Body(new RefuseNullFieldsPipe(['licenseId'])) body: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.edit(auth, code, body);
  }

  @Put(':code/translations/:lang')
  @HttpCode(204)
  putTranslation(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, lang }: TranslationParamsDto,
    @Body() body: PutTranslationDto,
  ): Promise<void> {
    return this.statements.putTranslation(auth, code, lang, body);
  }

  @Put(':code/editorial')
  @HttpCode(204)
  putEditorial(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: PutEditorialDto,
  ): Promise<void> {
    return this.statements.putEditorial(auth, code, body);
  }

  @RequirePermission('judge.clone_problem')
  @Post(':code/clone')
  clone(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: CloneProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.clones.clone(auth, code, body);
  }

  @RequirePermission('judge.edit_own_problem')
  @Post('render-preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() body: RenderPreviewDto,
  ): Promise<RenderPreviewResponse> {
    return this.statements.preview(auth, body);
  }
}
