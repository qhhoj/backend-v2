import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentServiceClient, RequireScope, ServiceOnly } from '@libs/auth';
import type { ServiceClientPrincipal } from '@libs/auth';
import {
  SyncContestDto,
  SyncContestKeyParamDto,
  SyncUpsertQueryDto,
} from './dto/sync-contest.dto';
import {
  SyncContestResponse,
  SyncUpsertResponse,
} from './dto/sync-contest.response';
import { SyncContestsService } from './sync-contests.service';

/** Not under `api/internal`: no cookie, no CSRF, an integration key only (`@ServiceOnly()`). nginx proxies `/api/sync/` to the api. */
@ServiceOnly()
@Controller('api/sync/v1')
export class SyncContestsController {
  constructor(private readonly contests: SyncContestsService) {}

  @RequireScope('contests:write')
  @Put('contests/:key')
  @HttpCode(200)
  put(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
    @Query() query: SyncUpsertQueryDto,
    @Body() body: SyncContestDto,
  ): Promise<SyncUpsertResponse> {
    return this.contests.put(client, {
      key,
      body,
      dryRun: query.dryRun === 'true',
    });
  }

  @RequireScope('contests:read')
  @Get('contests/:key')
  read(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
  ): Promise<SyncContestResponse> {
    return this.contests.read(client, key);
  }
}
