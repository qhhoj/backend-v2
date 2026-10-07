import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { UsernameParamDto } from '../core/dto/username-params.dto';
import { BanDto } from './dto/ban.dto';
import { UserModerationService } from './user-moderation.service';

@Controller('api/internal/users')
export class UserModerationController {
  constructor(private readonly moderation: UserModerationService) {}

  @Post(':username/ban')
  @HttpCode(204)
  @RequirePermission('judge.ban_user')
  ban(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
    @Body() { reason }: BanDto,
  ): Promise<void> {
    return this.moderation.ban(auth.principal, username, reason);
  }

  @Post(':username/unban')
  @HttpCode(204)
  @RequirePermission('judge.ban_user')
  unban(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
  ): Promise<void> {
    return this.moderation.unban(auth.principal, username);
  }
}
