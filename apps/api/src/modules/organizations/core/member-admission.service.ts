import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { withMemberSlotsLock } from './member-slots-lock';
import { OrganizationMembersRepository } from './organization-members.repository';
import { OrganizationsRepository } from './organizations.repository';
import { MEMBER_SLOTS_WAIT_SECONDS } from './rate-limits';

/** The one `slots` rule for a write that adds a member: a join, a request approval and a signup into an organization. */
@Injectable()
export class MemberAdmission {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly organizations: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
  ) {}

  /** No free slot now: `slots` (re-read) is set and the members reach it. */
  async isFull(organizationId: string): Promise<boolean> {
    const [organization] = await this.organizations.findByIds([organizationId]);
    return this.members.isFull(organizationId, organization?.slots ?? null);
  }

  /** Under the organization's member lock, so parallel admissions cannot pass the cap together: throws `full()` when no slot is free, else runs `write`. */
  admit<Result>(
    organizationId: string,
    full: () => Error | Promise<Error>,
    write: () => Promise<Result>,
  ): Promise<Result> {
    return withMemberSlotsLock(
      this.redis,
      organizationId,
      async () => {
        if (await this.isFull(organizationId)) throw await full();
        return write();
      },
      MEMBER_SLOTS_WAIT_SECONDS,
    );
  }
}
