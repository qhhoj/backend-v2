import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import {
  assertNotLockedByOfficialMode,
  MAX_OPEN_ORGANIZATIONS,
} from '@libs/community';
import { uuidStr } from '@libs/database';
import { SettingsService } from '@libs/settings';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationPointsService } from '../core/organization-points.service';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationsService } from '../core/organizations.service';

const conflict = (message: string) => new AppError('conflict', 409, message);

@Injectable()
export class MembershipService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizations: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly users: UsersRepository,
    private readonly points: OrganizationPointsService,
    private readonly settings: SettingsService,
  ) {}

  /** Legacy `JoinOrganization`: open organizations only, at most three open ones per user (private ones do not count). */
  async join(principal: Principal, slug: string): Promise<void> {
    assertNotLockedByOfficialMode(this.settings, principal);
    const organization = await this.organizationsService.bySlug(slug);
    if (!organization.isOpen)
      throw conflict('This organization is private; send a join request');
    const current = (await this.users.findById(
      principal.userId,
    ))!.organizations.map(uuidStr);
    if (current.includes(organization._id))
      throw conflict('You are already in this organization');
    const open = (await this.organizations.findByIds(current)).filter(
      (other) => other.isOpen,
    ).length;
    if (open >= MAX_OPEN_ORGANIZATIONS)
      throw conflict(
        `You may not be part of more than ${MAX_OPEN_ORGANIZATIONS} open organizations`,
      );
    if (
      !(await this.members.joinIfUnchanged(
        principal.userId,
        current,
        organization._id,
      ))
    )
      throw conflict('Your memberships changed meanwhile; try again');
    await this.points.refresh([organization._id]);
  }

  /** Legacy `LeaveOrganization`: admins cannot leave. */
  async leave(principal: Principal, slug: string): Promise<void> {
    assertNotLockedByOfficialMode(this.settings, principal);
    const organization = await this.organizationsService.bySlug(slug);
    if (
      OrganizationAccess.isAdmin(
        principal,
        OrganizationAccess.accessView(organization),
      )
    )
      throw conflict('Admins cannot leave their organization');
    if (!(await this.members.remove(principal.userId, organization._id)))
      throw conflict('You are not in this organization');
    await this.points.refresh([organization._id]);
  }

  /** Legacy `KickUserWidgetView`: administrators remove members, never admins. */
  async kick(
    principal: Principal,
    slug: string,
    userId: string,
  ): Promise<void> {
    const organization = await this.organizationsService.administered(
      principal,
      slug,
    );
    if (OrganizationAccess.accessView(organization).adminIds.includes(userId))
      throw conflict('Admins cannot be kicked');
    if (!(await this.members.remove(userId, organization._id)))
      throw conflict('That user is not in this organization');
    await this.points.refresh([organization._id]);
  }
}
