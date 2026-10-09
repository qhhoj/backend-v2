import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { ContestPublishService } from './contest-publish.service';
import { PublishProblemsDto } from './dto/publish-problems.dto';
import { PublishProblemsResponse } from './dto/publish-problems.response';

@Controller('api/internal/contests')
export class ContestPublishController {
  constructor(private readonly publishing: ContestPublishService) {}

  @Post(':key/publish-problems')
  @HttpCode(200)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() { editorials, dryRun }: PublishProblemsDto,
  ): Promise<PublishProblemsResponse> {
    return this.publishing.publish(auth, key, {
      editorials: editorials === true,
      dryRun: dryRun === true,
    });
  }
}
