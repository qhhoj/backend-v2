import { ApiTags } from '@nestjs/swagger';
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
@ApiTags('Sync API (integrations)')
@Controller('api/sync/v1')
export class SyncContestsController {
  constructor(
    private readonly contests: SyncContestsService,
    private readonly participants: SyncParticipantsService,
    private readonly removal: SyncContestRemovalService,
    private readonly standings: SyncStandingsService,
  ) {}

  /**
   * Create or update a synced contest
   *
   * @remarks
   * Integration key only (`Authorization: Bearer qhi_...`); cookies and user API tokens are refused with 403. Needs the `contests:write` scope. Idempotent upsert of the contest `key` from an external system. The body replaces the contest: an omitted optional field returns to its default. A new contest is created hidden and private, owned by the client and authored by its acting user; a person publishes it later.
   * With `dryRun=true` everything is validated and nothing is written. `action` tells whether the contest was `created`, `updated` or `unchanged`.
   * Errors: 400 `validation_failed` (reserved key `key_reserved`, unknown problem code, invalid times or format), 403 `forbidden` when the key belongs to a contest this client does not manage or the acting user lost its permissions, 409 `contest_frozen` when a published or started contest would change, 429 `rate_limited` (60 requests per client per minute across all sync routes).
   */
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

  /**
   * Read a synced contest
   *
   * @remarks
   * Integration key only (`Authorization: Bearer qhi_...`); cookies and user API tokens are refused with 403. Needs the `contests:read` scope. Returns the name, times, visibility and participant count of a contest this client manages. 404 `not_found` for a missing contest and for one managed by someone else.
   */
  @RequireScope('contests:read')
  @Get('contests/:key')
  read(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
  ): Promise<SyncContestResponse> {
    return this.contests.read(client, key);
  }

  /**
   * Replace the participants of a synced contest
   *
   * @remarks
   * Integration key only (`Authorization: Bearer qhi_...`); cookies and user API tokens are refused with 403. Needs the `contests:write` scope. Replaces the contestant list with the given usernames, at any time, even after the contest is published or started. Sync never creates users: usernames that match no active user are returned in `unknown` and skipped. At most 2000 usernames. 404 `not_found`, 429 `rate_limited`.
   */
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

  /**
   * Delete a synced contest
   *
   * @remarks
   * Integration key only (`Authorization: Bearer qhi_...`); cookies and user API tokens are refused with 403. Needs the `contests:write` scope. Deletes a contest this client manages, only while it is unpublished, has not started and has no submissions. Errors: 404 `not_found`, 409 `contest_not_deletable`, 429 `rate_limited`. Returns 204.
   */
  @RequireScope('contests:write')
  @Delete('contests/:key')
  @HttpCode(204)
  remove(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
  ): Promise<void> {
    return this.removal.remove(client, key);
  }

  /**
   * Get the standings of a synced contest
   *
   * @remarks
   * Integration key only (`Authorization: Bearer qhi_...`); cookies and user API tokens are refused with 403. Needs the `contests:read` scope. Returns the scoreboard as an anonymous visitor would see it: frozen values during a freeze, live values otherwise. Errors: 403 `forbidden` (issue `board_hidden`) while the board is hidden from the public, 404 `not_found`, 429 `rate_limited`.
   */
  @RequireScope('contests:read')
  @Get('contests/:key/standings')
  getStandings(
    @CurrentServiceClient() client: ServiceClientPrincipal,
    @Param() { key }: SyncContestKeyParamDto,
  ): Promise<RankingResponse> {
    return this.standings.standings(client, key);
  }
}
