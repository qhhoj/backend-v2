import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { ContestPublishService } from './contest-publish.service';
import { PublishProblemsDto } from './dto/publish-problems.dto';
import { PublishProblemsResponse } from './dto/publish-problems.response';

@ApiTags('Contest editing')
@Controller('api/internal/contests')
export class ContestPublishController {
  constructor(private readonly publishing: ContestPublishService) {}

  /**
   * Publish the problems of an ended contest
   *
   * @remarks
   * Contest editors only, after the contest has ended (409
   * `contest_not_ended`). Judges each problem with the same rule as the
   * automatic job and makes it public, and with `editorials` true also its
   * editorial, writing a revision for each change. Use `dryRun` to see the
   * verdicts without changing anything. A real run is limited to a few per
   * hour per user. Returns one item per problem with its outcome.
   */
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
