import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrganizationCreditEntry,
  OrganizationUsage,
  uuidStr,
} from '@libs/database';
import type { Model } from 'mongoose';

export interface MonthTotal {
  organization: string;
  month: string;
  total: number;
}

@Injectable()
export class OrganizationUsageAuditRepository {
  constructor(
    @InjectModel(OrganizationUsage.name)
    private readonly usage: Model<OrganizationUsage>,
    @InjectModel(OrganizationCreditEntry.name)
    private readonly ledger: Model<OrganizationCreditEntry>,
  ) {}

  /** Ledger sum (refunds are negative rows) per organization and month, through `{organization, month, _id}`. */
  async ledgerTotals(months: string[]): Promise<MonthTotal[]> {
    const rows = await this.ledger.aggregate<{
      _id: { organization: unknown; month: string };
      total: number;
    }>([
      { $match: { month: { $in: months } } },
      {
        $group: {
          _id: { organization: '$organization', month: '$month' },
          total: { $sum: '$amount' },
        },
      },
    ]);
    return rows.map((row) => ({
      organization: uuidStr(row._id.organization),
      month: row._id.month,
      total: row.total,
    }));
  }

  async counterTotals(months: string[]): Promise<MonthTotal[]> {
    const rows = await this.usage
      .find(
        { month: { $in: months } },
        { organization: 1, month: 1, creditsUsed: 1 },
      )
      .lean()
      .exec();
    return rows.map((row) => ({
      organization: uuidStr(row.organization),
      month: row.month,
      total: row.creditsUsed,
    }));
  }
}
