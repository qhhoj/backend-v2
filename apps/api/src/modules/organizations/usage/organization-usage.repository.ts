import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Organization, OrganizationCreditEntry, uuidStr } from '@libs/database';
import type { Model, PipelineStage } from 'mongoose';
import type { UsageSort } from './dto/usage.dto';

interface OverviewRow {
  id: string;
  slug: string;
  name: string;
  creditsUsed: number;
  judgingUsed: number;
  quotaMonthlyCredits: number | null;
  quotaJudgingMs: number | null;
  quotaStorageBytes: number | null;
  quotaUnlimited: boolean;
}

export interface QuotaChanges {
  quotaMonthlyCredits?: number | null;
  quotaJudgingMs?: number | null;
  quotaStorageBytes?: number | null;
  quotaUnlimited?: boolean;
}

const RECENT_ENTRIES = 20;

interface OverviewQuery {
  sort: UsageSort;
  page: number;
  pageSize: number;
}

/** Typed on purpose: a ternary of two object literals is not a valid `$sort` for the compiler. */
const OVERVIEW_SORTS: Record<UsageSort, Record<string, 1 | -1>> = {
  credits: { creditsUsed: -1, name: 1 },
  judging: { judgingUsed: -1, name: 1 },
  name: { name: 1 },
};

/** The organization's judging charges of `month`, summed (absent with none). */
const judgingLookup = (month: string): PipelineStage.Lookup => ({
  $lookup: {
    from: 'organizationJudgingCharges',
    let: { id: '$_id' },
    pipeline: [
      { $match: { month, $expr: { $eq: ['$organization', '$$id'] } } },
      { $group: { _id: null, ms: { $sum: '$ms' } } },
    ],
    as: 'judging',
  },
});

/** Every live organization with its credits (0 without a usage row) and judging time used in `month`, one sorted page. */
function overviewPipeline(
  month: string,
  query: OverviewQuery,
): PipelineStage[] {
  return [
    { $match: { deletedAt: null } },
    {
      $lookup: {
        from: 'organizationUsage',
        let: { id: '$_id' },
        pipeline: [
          { $match: { month, $expr: { $eq: ['$organization', '$$id'] } } },
        ],
        as: 'usage',
      },
    },
    judgingLookup(month),
    {
      $addFields: {
        creditsUsed: { $ifNull: [{ $first: '$usage.creditsUsed' }, 0] },
        judgingUsed: { $ifNull: [{ $first: '$judging.ms' }, 0] },
      },
    },
    { $sort: OVERVIEW_SORTS[query.sort] },
    { $skip: (query.page - 1) * query.pageSize },
    { $limit: query.pageSize },
    {
      $project: {
        slug: 1,
        name: 1,
        creditsUsed: 1,
        judgingUsed: 1,
        quotaMonthlyCredits: 1,
        quotaJudgingMs: 1,
        quotaStorageBytes: 1,
        quotaUnlimited: 1,
      },
    },
  ];
}

@Injectable()
export class OrganizationUsageRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(OrganizationCreditEntry.name)
    private readonly ledger: Model<OrganizationCreditEntry>,
  ) {}

  recentEntries(organizationId: string): Promise<OrganizationCreditEntry[]> {
    return this.ledger
      .find({ organization: organizationId })
      .sort({ _id: -1 })
      .limit(RECENT_ENTRIES)
      .lean()
      .exec();
  }

  async setQuota(organizationId: string, changes: QuotaChanges): Promise<void> {
    await this.organizations
      .updateOne({ _id: organizationId }, { $set: changes })
      .exec();
  }

  /** One page of organizations with this month's credits and judging time, sorted by name or by either one used (heaviest first). */
  async overview(
    month: string,
    query: OverviewQuery,
  ): Promise<{ rows: OverviewRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.organizations.aggregate<OverviewRow & { _id: unknown }>(
        overviewPipeline(month, query),
      ),
      this.organizations.countDocuments({ deletedAt: null }).exec(),
    ]);
    return {
      rows: rows.map((row) => ({ ...row, id: uuidStr(row._id as string) })),
      total,
    };
  }
}
