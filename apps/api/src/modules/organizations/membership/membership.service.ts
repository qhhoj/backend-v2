import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, conflictIssue, REDIS } from '@libs/common';
import {
  assertNotLockedByOfficialMode,
  MAX_OPEN_ORGANIZATIONS,
} from '@libs/community';
import { uuidStr } from '@libs/database';
import { SettingsService } from '@libs/settings';
import type Redis from 'ioredis';
import { withMemberSlotsLock } from '../core/member-slots-lock';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationPointsService } from '../core/organization-points.service';
import {
  OrganizationsRepository,
  type OrganizationDocument,
} from '../core/organizations.repository';
import { OrganizationsService } from '../core/organizations.service';
import { MEMBER_SLOTS_WAIT_SECONDS } from '../core/rate-limits';
import { OrganizationRevisionsService } from '../editing/organization-revisions.service';

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
    private readonly history: OrganizationRevisionsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `JoinOrganization`: open organizations only, at most three open ones per user (private ones do not count). The `slots` count and the write share the organization's member lock, so parallel joins cannot overfill it. */
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
    await this.assertOpenCap(current);
    await withMemberSlotsLock(
      this.redis,
      organization._id,
      () => this.joinWithinSlots(principal.userId, current, organization),
      MEMBER_SLOTS_WAIT_SECONDS,
    );
    await this.points.refresh([organization._id]);
  }

  private async assertOpenCap(current: readonly string[]): Promise<void> {
    const open = (await this.organizations.findByIds([...current])).filter(
      (other) => other.isOpen,
    ).length;
    if (open >= MAX_OPEN_ORGANIZATIONS)
      throw conflict(
        `You may not be part of more than ${MAX_OPEN_ORGANIZATIONS} open organizations`,
      );
  }

  /** Call under `withMemberSlotsLock`. */
  private async joinWithinSlots(
    userId: string,
    current: readonly string[],
    organization: OrganizationDocument,
  ): Promise<void> {
    if (await this.members.isFull(organization._id, organization.slots))
      throw conflictIssue(
        'organization',
        'organization_full',
        'The organization is full',
      );
    if (
      !(await this.members.joinIfUnchanged(userId, current, organization._id))
    )
      throw conflict('Your memberships changed meanwhile; try again');
  }

  /**
   * Legacy `LeaveOrganization`, except that an administrator may leave while another administrator remains (owner
   * decision 2026-10-18); the last one is refused (`last_admin`) and must hand over first. Leaving gives up the
   * administrator rights too, recorded in the organization's history; the admin role group is kept, as on any demotion.
   */
  async leave(principal: Principal, slug: string): Promise<void> {
    assertNotLockedByOfficialMode(this.settings, principal);
    const organization = await this.organizationsService.bySlug(slug);
    if (!(await this.members.isMember(principal.userId, organization._id)))
      throw conflict('You are not in this organization');
    if (
      OrganizationAccess.isAdmin(
        principal,
        OrganizationAccess.accessView(organization),
      )
    )
      await this.stepDown(principal, organization);
    if (!(await this.members.remove(principal.userId, organization._id)))
      throw conflict('You are not in this organization');
    await this.points.refresh([organization._id]);
  }

  private async stepDown(
    principal: Principal,
    organization: OrganizationDocument,
  ): Promise<void> {
    if (
      !(await this.organizations.removeAdminUnlessLast(
        organization._id,
        principal.userId,
      ))
    )
      throw conflictIssue(
        'user',
        'last_admin',
        'You are the only administrator; make someone else an administrator before you leave',
      );
    const { adminIds } = OrganizationAccess.accessView(organization);
    await this.history.recordChange(principal, organization._id, {
      action: 'edit',
      before: { adminIds },
      after: { adminIds: adminIds.filter((id) => id !== principal.userId) },
    });
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
      throw conflictIssue(
        'user',
        'admin_not_kickable',
        'Admins cannot be kicked',
      );
    if (!(await this.members.remove(userId, organization._id)))
      throw conflictIssue(
        'user',
        'not_member',
        'That user is not in this organization',
      );
    await this.points.refresh([organization._id]);
    const kicked = await this.users.findById(userId);
    await this.history.recordKick(
      principal,
      organization._id,
      kicked?.username ?? userId,
    );
  }
}
