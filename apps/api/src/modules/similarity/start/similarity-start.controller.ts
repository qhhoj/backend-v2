import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ScopeQueryDto } from '../core/dto/scope-query.dto';
import { StartedSimilarityRunResponse } from './dto/started-run.response';
import { SimilarityStartService } from './similarity-start.service';

@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity/runs')
export class SimilarityStartController {
  constructor(private readonly starts: SimilarityStartService) {}

  @Post()
  @HttpCode(202)
  start(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ScopeQueryDto,
  ): Promise<StartedSimilarityRunResponse> {
    return this.starts.start(auth.principal, dto);
  }
}
