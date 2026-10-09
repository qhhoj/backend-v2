import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationProblemsRepository } from './organization-problems.repository';

@Injectable()
export class ArchiveNoticeService {
  constructor(
    private readonly problems: ProblemsRepository,
    private readonly links: OrganizationProblemsRepository,
    private readonly organizations: OrganizationsRepository,
  ) {}

  /** The viewer's organizations that archived the problem, for the notice on the problem page. A viewer who cannot see the problem gets the same 404 as everyone. */
  async organizationsFor(
    principal: Principal,
    code: string,
  ): Promise<Array<{ slug: string; name: string }>> {
    const problem = await this.problems.findForAccessByCode(code);
    if (
      !problem ||
      !ProblemAccess.canSee(principal, ProblemAccess.accessView(problem), null)
    )
      throw new AppError('not_found', 404, 'No such problem');
    const ids = await this.links.archivedOrganizationIds(problem._id);
    const organizations = await this.organizations.findByIds(ids);
    return organizations
      .filter((organization) => {
        const view = OrganizationAccess.accessView(organization);
        return (
          OrganizationAccess.isMember(principal, view.id) ||
          OrganizationAccess.canAdminister(principal, view)
        );
      })
      .map(({ slug, name }) => ({ slug, name }));
  }
}
