import { Injectable } from '@nestjs/common';
import type { UserDocument } from '@libs/auth';
import { AppError, ValidationFailedError } from '@libs/common';
import { uuidStr } from '@libs/database';
import { OrganizationMembersRepository } from '../../organizations/core/organization-members.repository';
import { OrganizationPointsService } from '../../organizations/core/organization-points.service';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';

export interface MembershipPlan {
  current: string[];
  next: string[];
  /** Added and dropped organizations, whose points need a refresh. */
  changed: string[];
}

const membershipIssue = (code: string, message: string) =>
  new ValidationFailedError(message, [
    { field: 'organizations', code, message },
  ]);

/** Staff replace a user's whole membership list (legacy Profile admin): checked first, written after the other checks passed. */
@Injectable()
export class UserMembershipEditor {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly points: OrganizationPointsService,
  ) {}

  /** Null when unchanged. Every added organization must exist and no dropped one may be administered by the user. Writes nothing. */
  async plan(
    user: UserDocument,
    next: string[] | undefined,
  ): Promise<MembershipPlan | null> {
    const current = user.organizations.map(uuidStr);
    if (next === undefined || next.join() === current.join()) return null;
    const added = next.filter((id) => !current.includes(id));
    const dropped = current.filter((id) => !next.includes(id));
    const found = await this.organizations.findByIds([...added, ...dropped]);
    const foundIds = new Set(
      found.map((organization) => uuidStr(organization._id)),
    );
    if (added.some((id) => !foundIds.has(id)))
      throw membershipIssue(
        'organization_unknown',
        'Choose existing organizations.',
      );
    const userId = uuidStr(user._id);
    const administers = found.some(
      (organization) =>
        dropped.includes(uuidStr(organization._id)) &&
        organization.adminIds.map(uuidStr).includes(userId),
    );
    if (administers)
      throw membershipIssue(
        'organization_admin_member',
        'Remove the user as an organization admin first.',
      );
    return { current, next, changed: [...added, ...dropped] };
  }

  /** Compare-and-set on the whole list; staff bypass the open-organization cap and slots, like legacy admin. */
  async write(
    user: UserDocument,
    { current, next, changed }: MembershipPlan,
  ): Promise<void> {
    if (!(await this.members.reorderIfUnchanged(user._id, current, next)))
      throw new AppError(
        'conflict',
        409,
        'Memberships changed meanwhile; try again',
      );
    await this.points.refresh(changed);
  }
}
