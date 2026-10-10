import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import { KickDto } from './dto/kick.dto';
import { MembershipService } from './membership.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  /**
   * Join an open organization
   *
   * @remarks
   * Adds the signed-in user to an organization that is open. A user may be in
   * at most three open organizations (private ones do not count). Returns 204.
   * Refusals are 409 `conflict` for a private organization (send a join
   * request instead), an organization already joined, or the open-organization
   * cap; 409 `organization_full` when the organization has no free slot; and
   * 403 `locked_in_official_contest` while an official contest locks it.
   */
  @Post(':slug/join')
  @HttpCode(204)
  join(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<void> {
    return this.membership.join(auth.principal, slug);
  }

  /**
   * Leave an organization
   *
   * @remarks
   * Removes the signed-in user from the organization and returns 204. Admins
   * cannot leave (409 `conflict`), nor can a user who is not a member. Locked
   * during an official contest (403 `locked_in_official_contest`).
   */
  @Post(':slug/leave')
  @HttpCode(204)
  leave(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
  ): Promise<void> {
    return this.membership.leave(auth.principal, slug);
  }

  /**
   * Remove a member from an organization
   *
   * @remarks
   * Organization administrators (and holders of `judge.edit_all_organization`)
   * remove the member given by `userId`. Admins cannot be removed, and the
   * user must be a member (409 `conflict`). Returns 204; 403 `forbidden` for
   * non-administrators.
   */
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
