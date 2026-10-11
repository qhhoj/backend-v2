import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { ContestOrganizationResponse } from './dto/contest-list.response';

/** The organizations an organization-private contest is restricted to, for the contest's tag chips. */
@Injectable()
export class ContestOrganizationsService {
  constructor(private readonly organizations: OrganizationsRepository) {}

  /**
   * Per contest id, its restricting organizations in the contest's own order.
   * Unlisted ones appear only to viewers who may enumerate them
   * (members and staff), like everywhere else organizations are listed.
   */
  async forContests(
    principal: Principal | null,
    contests: readonly Contest[],
  ): Promise<Map<string, ContestOrganizationResponse[]>> {
    const restricted = (contest: Contest) =>
      contest.isOrganizationPrivate ? contest.organizations.map(uuidStr) : [];
    const found = await this.organizations.findByIds(
      unique(contests.flatMap(restricted)),
    );
    const visible = new Map(
      found
        .filter((organization) =>
          OrganizationAccess.canList(
            principal,
            OrganizationAccess.accessView(organization),
          ),
        )
        .map((organization) => [uuidStr(organization._id), organization]),
    );
    return new Map(
      contests.map((contest) => [
        uuidStr(contest._id),
        restricted(contest).flatMap((id) => {
          const organization = visible.get(id);
          return organization
            ? [ContestOrganizationResponse.from(organization)]
            : [];
        }),
      ]),
    );
  }
}
