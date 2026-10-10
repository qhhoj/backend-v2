import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentAuth, NoImpersonation, SessionOnly } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import {
  FeedKeyStatusResponse,
  MintedFeedKeyResponse,
  MintFeedKeyDto,
} from './dto/feed-key.dto';
import { FeedKeysService } from './feed-keys.service';

/** Credential routes: a leaked API token or an impersonating admin must not mint, revoke or release (decisions.md). */
@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/feed-key')
export class FeedKeysController {
  constructor(private readonly keys: FeedKeysService) {}

  /**
   * Get the feed key status of a contest
   *
   * @remarks
   * Contest editors only. Tells whether a usable feed key exists, its mode,
   * expiry, release time and the editor it belongs to. The key itself is never
   * shown again.
   */
  @Get()
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<FeedKeyStatusResponse> {
    return this.keys.status(auth.principal, key);
  }

  /**
   * Create a feed key for a contest
   *
   * @remarks
   * Contest editors only, with a browser session (no API tokens, no
   * impersonation). Creates a key and returns it once with the Basic user name
   * `feed`; earlier keys stop working. The mode is `frozen-until-release` by
   * default or `live`, and it expires after `expiresInDays` (at most 30).
   * Limited to a few per hour.
   */
  @Post()
  @SessionOnly()
  @NoImpersonation()
  mint(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: MintFeedKeyDto,
  ): Promise<MintedFeedKeyResponse> {
    return this.keys.mint(auth.principal, key, dto);
  }

  /**
   * Revoke the feed keys of a contest
   *
   * @remarks
   * Contest editors only, with a browser session. Revokes every feed key of
   * the contest; returns 204.
   */
  @Delete()
  @HttpCode(204)
  @SessionOnly()
  @NoImpersonation()
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.keys.revoke(auth.principal, key);
  }

  /**
   * Release the feed to the resolver
   *
   * @remarks
   * Contest editors only, with a browser session. Stops cutting the feed at
   * the freeze in progress. Returns 204; 409 `no_active_feed_key` without a
   * usable key and 409 `not_frozen` when no freeze is on.
   */
  @Post('release')
  @HttpCode(204)
  @SessionOnly()
  @NoImpersonation()
  release(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.keys.release(auth.principal, key);
  }
}
