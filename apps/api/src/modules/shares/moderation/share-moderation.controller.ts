import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import { MANAGE_SHARE } from '../core/share-access.service';
import type { AuthContext } from '@libs/auth';
import { ShareCodeParamDto } from '../core/dto/share-params.dto';
import { TakedownShareDto } from './dto/takedown-share.dto';
import { ShareModerationService } from './share-moderation.service';

@ApiTags('Shares')
@Controller('api/internal/shares')
export class ShareModerationController {
  constructor(private readonly moderation: ShareModerationService) {}

  /**
   * Take a share down
   *
   * @remarks
   * Requires `judge.manage_share`. Everyone else gets 404 for the link from now on; the owner sees the takedown and its `reason` in their list. Reversible with restore; both are audit-logged. 404 `not_found` for an unknown or expired code, 409 `conflict` when already down. Returns 204.
   */
  @RequirePermission(MANAGE_SHARE)
  @Post(':code/takedown')
  @HttpCode(204)
  takedown(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShareCodeParamDto,
    @Body() { reason }: TakedownShareDto,
  ): Promise<void> {
    return this.moderation.takedown(auth.principal, code, reason);
  }

  /**
   * Restore a taken-down share
   *
   * @remarks
   * Requires `judge.manage_share`. The link reads again as before (a banned author's links stay down until the ban is lifted). Audit-logged. 404 `not_found` for an unknown or expired code, 409 `conflict` when it is not down. Returns 204.
   */
  @RequirePermission(MANAGE_SHARE)
  @Post(':code/restore')
  @HttpCode(204)
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShareCodeParamDto,
  ): Promise<void> {
    return this.moderation.restore(auth.principal, code);
  }
}
