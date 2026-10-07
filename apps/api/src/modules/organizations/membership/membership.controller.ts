import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import { KickDto } from './dto/kick.dto';
import { MembershipService } from './membership.service';

@Controller('api/internal/organizations')
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Post(':slug/join')
  @HttpCode(204)
  join(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<void> {
    return this.membership.join(auth.principal, slug);
  }

  @Post(':slug/leave')
  @HttpCode(204)
  leave(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<void> {
    return this.membership.leave(auth.principal, slug);
  }

  @Post(':slug/kick')
  @HttpCode(204)
  kick(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() { userId }: KickDto,
  ): Promise<void> {
    return this.membership.kick(auth.principal, slug, userId);
  }
}
