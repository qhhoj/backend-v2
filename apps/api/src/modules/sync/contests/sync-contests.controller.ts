import {
  Body,
  Controller,
  Delete,
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
import type { RankingResponse } from '../../contests/ranking/dto/ranking.response';
import { SyncParticipantsDto } from './dto/sync-participants.dto';
import { SyncParticipantsResponse } from './dto/sync-participants.response';
import { SyncContestRemovalService } from './sync-contest-removal.service';
import { SyncContestsService } from './sync-contests.service';
import { SyncParticipantsService } from './sync-participants.service';
import { SyncStandingsService } from './sync-standings.service';

/** Not under `api/internal`: no cookie, no CSRF, an integration key only (`@ServiceOnly()`). nginx proxies `/api/sync/` to the api. */
@ServiceOnly()
@Controller('api/sync/v1')
export class SyncContestsController {
  constructor(
    private readonly contests: SyncContestsService,
    private readonly participants: SyncParticipantsService,
    private readonly removal: SyncContestRemovalService,
    private readonly standings: SyncStandingsService,
  ) {}

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

  @RequireScope('contests:write')
  @Put('contests/:key/participants')
  @HttpCode(200)
  setParticipants(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
    @Body() { usernames }: SyncParticipantsDto,
  ): Promise<SyncParticipantsResponse> {
    return this.participants.replace(client, key, usernames);
  }

  @RequireScope('contests:write')
  @Delete('contests/:key')
  @HttpCode(204)
  remove(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
  ): Promise<void> {
    return this.removal.remove(client, key);
  }

  @RequireScope('contests:read')
  @Get('contests/:key/standings')
  getStandings(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
  ): Promise<RankingResponse> {
    return this.standings.standings(client, key);
  }
}
