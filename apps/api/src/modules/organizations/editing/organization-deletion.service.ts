import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationRequestsRepository } from '../core/organization-requests.repository';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationUnlinkRepository } from './organization-unlink.repository';
import { OrganizationRevisionsService } from './organization-revisions.service';

/** Superuser-only soft delete; no legacy view (the old site cascaded through the Django admin). */
@Injectable()
export class OrganizationDeletionService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly requests: OrganizationRequestsRepository,
    private readonly unlink: OrganizationUnlinkRepository,
    private readonly history: OrganizationRevisionsService,
  ) {}

  /** Marks deleted first, so no join or admin action can reach it while it is detached; a repeated delete runs the idempotent unlinks again. */
  async delete(principal: Principal, slug: string): Promise<void> {
    // A permission would not do: `hasPermission` is true for any holder, and this is for superusers alone.
    if (!principal.isSuperuser)
      throw new AppError(
        'forbidden',
        403,
        'Only superusers may delete organizations',
      );
    const organization =
      await this.organizations.findBySlugIncludingDeleted(slug);
    if (!organization)
      throw new AppError('not_found', 404, 'No such organization');
    const id = organization._id;
    if (await this.organizations.markDeleted(id, principal.userId))
      await this.history.recordDelete(principal, id);
    await this.unlink.unlinkProblemsAndContests(id);
    await this.unlink.unlinkPosts(id);
    await this.requests.rejectAllPending(id, principal.userId, new Date());
    await this.members.removeAll(id);
  }
}
