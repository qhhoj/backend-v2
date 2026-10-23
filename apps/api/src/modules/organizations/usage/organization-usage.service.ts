import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { Paginated } from '@libs/common';
import { QuotaLedger } from '@libs/problems';
import { uuidStr } from '@libs/database';
import type { OrganizationCreditEntry } from '@libs/database';
import type { OrganizationDocument } from '../core/organizations.repository';
import { OrganizationsService } from '../core/organizations.service';
import { QuotaService } from '../quota/quota.service';
import { usernamesById } from '../requests/request-usernames';
import type { UpdateQuotaDto, UsageOverviewQueryDto } from './dto/usage.dto';
import type {
  CreditEntryResponse,
  OrganizationUsageResponse,
  UsageOverviewRowResponse,
} from './dto/usage.response';
import { OrganizationUsageRepository } from './organization-usage.repository';
import type { QuotaChanges } from './organization-usage.repository';

/** Rows of the usage response's "most judging time" table. */
const TOP_PROBLEMS = 5;

const quotaOf = (organization: OrganizationDocument) => ({
  quotaMonthlyCredits: organization.quotaMonthlyCredits ?? null,
  quotaJudgingMs: organization.quotaJudgingMs ?? null,
  quotaStorageBytes: organization.quotaStorageBytes ?? null,
  quotaUnlimited: organization.quotaUnlimited ?? false,
});

/** Only the caps the request named; `null` is a value (clear), absent is not. */
const changesOf = (dto: UpdateQuotaDto): QuotaChanges => ({
  ...(dto.quotaMonthlyCredits !== undefined && {
    quotaMonthlyCredits: dto.quotaMonthlyCredits,
  }),
  ...(dto.quotaJudgingMs !== undefined && {
    quotaJudgingMs: dto.quotaJudgingMs,
  }),
  ...(dto.quotaStorageBytes !== undefined && {
    quotaStorageBytes: dto.quotaStorageBytes,
  }),
  ...(dto.quotaUnlimited !== undefined && {
    quotaUnlimited: dto.quotaUnlimited,
  }),
});

@Injectable()
export class OrganizationUsageService {
  private readonly logger = new Logger(OrganizationUsageService.name);

  constructor(
    private readonly organizations: OrganizationsService,
    private readonly quota: QuotaService,
    private readonly ledger: QuotaLedger,
    private readonly repository: OrganizationUsageRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Organization administrators and `edit_all_organization` holders. */
  async usage(
    principal: Principal,
    slug: string,
  ): Promise<OrganizationUsageResponse> {
    return this.respond(await this.organizations.administered(principal, slug));
  }

  async updateQuota(
    principal: Principal,
    slug: string,
    dto: UpdateQuotaDto,
  ): Promise<OrganizationUsageResponse> {
    const organization = await this.organizations.bySlug(slug);
    const before = quotaOf(organization);
    const changes = changesOf(dto);
    await this.repository.setQuota(organization._id, changes);
    this.logger.log(
      JSON.stringify({
        event: 'organization.quota.changed',
        actor: principal.userId,
        organization: organization._id,
        before,
        after: { ...before, ...changes },
      }),
    );
    return this.respond(await this.organizations.bySlug(slug));
  }

  async overview(
    query: UsageOverviewQueryDto,
  ): Promise<Paginated<UsageOverviewRowResponse>> {
    const month = this.ledger.monthKeyOf(new Date());
    const { rows, total } = await this.repository.overview(month, query);
    const bytes = await this.ledger.usedStorageBytesOf(
      rows.map((row) => row.id),
    );
    return new Paginated(
      rows.map((row) => {
        const limits = this.ledger.limitsFrom(row);
        return {
          slug: row.slug,
          name: row.name,
          month,
          creditsUsed: row.creditsUsed,
          creditsLimit: limits.credits,
          judgingUsed: row.judgingUsed,
          judgingLimit: limits.judgingMs,
          storageUsed: bytes.get(row.id) ?? 0,
          storageLimit: limits.storageBytes,
          unlimited: limits.unlimited,
        };
      }),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  private async respond(
    organization: OrganizationDocument,
  ): Promise<OrganizationUsageResponse> {
    const now = new Date();
    const [snapshot, recent, topProblems] = await Promise.all([
      this.quota.snapshot(organization._id, now),
      this.repository.recentEntries(organization._id),
      this.ledger.topProblems(
        organization._id,
        this.ledger.monthKeyOf(now),
        TOP_PROBLEMS,
      ),
    ]);
    const caps = quotaOf(organization);
    return {
      organization: { slug: organization.slug, name: organization.name },
      month: snapshot.month,
      enforcing: snapshot.enforcing,
      unlimited: snapshot.unlimited,
      credits: snapshot.credits,
      judging: snapshot.judging,
      storage: snapshot.storage,
      quota: {
        monthlyCredits: caps.quotaMonthlyCredits,
        judgingMs: caps.quotaJudgingMs,
        storageBytes: caps.quotaStorageBytes,
      },
      recent: await this.entriesOf(recent),
      topProblems,
    };
  }

  /** One user lookup for the whole page; an entry without a user, or whose user is gone, has no actor. */
  private async entriesOf(
    recent: OrganizationCreditEntry[],
  ): Promise<CreditEntryResponse[]> {
    const spenders = recent.flatMap(({ user }) =>
      user ? [uuidStr(user)] : [],
    );
    const names = await usernamesById(this.users, spenders);
    return recent.map(({ reason, amount, ref, user, createdAt }) => {
      const username = user ? names.get(uuidStr(user)) : undefined;
      const actor = user && username ? { id: uuidStr(user), username } : null;
      return { reason, amount, ref, actor, createdAt };
    });
  }
}
