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
@Controller('api/internal/contests/:key/feed-key')
export class FeedKeysController {
  constructor(private readonly keys: FeedKeysService) {}

  @Get()
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<FeedKeyStatusResponse> {
    return this.keys.status(auth.principal, key);
  }

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
