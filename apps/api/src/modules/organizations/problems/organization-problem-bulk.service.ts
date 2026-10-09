import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { invalidField, RateLimitService } from '@libs/common';
import { uuidStr } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { OrganizationsService } from '../core/organizations.service';
import { ProblemTagsRepository } from '../problem-tags/problem-tags.repository';
import { bulkUpdate } from './bulk-update';
import { MAX_BULK_CODES } from './dto/bulk.dto';
import type { BulkProblemsDto } from './dto/bulk.dto';
import type {
  BulkProblemsResponse,
  BulkResultResponse,
} from './dto/bulk.response';
import { OrganizationProblemsRepository } from './organization-problems.repository';
import { BULK_LIMIT, BULK_WINDOW_SECONDS } from './rate-limits';

@Injectable()
export class OrganizationProblemBulkService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly problems: ProblemsRepository,
    private readonly links: OrganizationProblemsRepository,
    private readonly tags: ProblemTagsRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** One result per requested code. Only live problems that list this organization change; the rest are `skipped`, never an error, so a stale selection still applies the rest. */
  async run(
    principal: Principal,
    slug: string,
    dto: BulkProblemsDto,
  ): Promise<BulkProblemsResponse> {
    const organization = await this.organizations.administered(principal, slug);
    if (dto.tagId) await this.requireTag(organization._id, dto.tagId);
    await this.rateLimit.reserve(
      [`org-problems-bulk:user:${principal.userId}`],
      BULK_LIMIT,
      BULK_WINDOW_SECONDS,
    );
    const owned = await this.problems.findPage(
      { code: { $in: dto.codes }, organizations: organization._id },
      { code: 1 },
      1,
      MAX_BULK_CODES,
    );
    const update = bulkUpdate(dto.action, dto.tagId);
    await this.links.bulkWrite(
      owned.map((problem) => ({
        updateOne: {
          filter: {
            organization: organization._id,
            problem: uuidStr(problem._id),
          },
          update,
          upsert: true,
        },
      })),
    );
    return summary(dto.codes, new Set(owned.map((problem) => problem.code)));
  }

  private async requireTag(
    organizationId: string,
    tagId: string,
  ): Promise<void> {
    if ((await this.tags.findByIds(organizationId, [tagId])).length !== 1)
      throw invalidField('tagId', 'Unknown tag.', 'unknown_tag');
  }
}

const summary = (codes: string[], done: Set<string>): BulkProblemsResponse => {
  const results: BulkResultResponse[] = codes.map((code) =>
    done.has(code)
      ? { code, outcome: 'done' }
      : { code, outcome: 'skipped', reason: 'not_found' },
  );
  return { results, done: done.size, skipped: results.length - done.size };
};
