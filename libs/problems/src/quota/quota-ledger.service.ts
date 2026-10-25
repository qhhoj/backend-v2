import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { FilterQuery, Model } from 'mongoose';
import { AppError, REDIS } from '@libs/common';
import {
  Organization,
  OrganizationCreditEntry,
  OrganizationJudgingCharge,
  OrganizationUsage,
  Problem,
  toUuid,
} from '@libs/database';
import { SettingsService } from '@libs/settings';
import { QUOTA_BACKFILL_DONE_KEY } from '../quota-queues';
import { sumStoredBytesByOrganization } from './organization-storage';
import { quotaMonthOf } from './quota-month';
import type {
  EffectiveLimits,
  PricedCharge,
  ProblemJudgingTime,
  QuotaRefusal,
  SpentCharge,
  UsageKey,
} from './quota.types';

/** A refund claim outlives the import job it is for (kept a day). */
const REFUND_CLAIM_SECONDS = 7 * 24 * 60 * 60;

/** The organization quota primitives the api (`QuotaService`) and the worker share: limits, enforce mode, the ledger's give-back and the storage meter. */
@Injectable()
export class QuotaLedger {
  private readonly logger = new Logger(QuotaLedger.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(OrganizationUsage.name)
    private readonly usage: Model<OrganizationUsage>,
    @InjectModel(OrganizationCreditEntry.name)
    private readonly ledger: Model<OrganizationCreditEntry>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(OrganizationJudgingCharge.name)
    private readonly judgingCharges: Model<OrganizationJudgingCharge>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** `enforce` blocks only after the `dataBytes` backfill has finished; until then the site stays in warn mode whatever the setting says. */
  async isEnforcing(): Promise<boolean> {
    return (
      this.settings.get('quota.enforce') === 'enforce' &&
      (await this.redis.get(QUOTA_BACKFILL_DONE_KEY)) === '1'
    );
  }

  monthKeyOf(now: Date): string {
    return quotaMonthOf(this.settings, now);
  }

  /** The effective limits of an organization row: its own caps, else the site defaults. */
  limitsFrom(
    row: {
      quotaMonthlyCredits?: number | null;
      quotaJudgingMs?: number | null;
      quotaStorageBytes?: number | null;
      quotaUnlimited?: boolean;
    } | null,
  ): EffectiveLimits {
    return {
      unlimited: row?.quotaUnlimited ?? false,
      credits:
        row?.quotaMonthlyCredits ??
        this.settings.get('quota.defaultMonthlyCredits'),
      judgingMs:
        row?.quotaJudgingMs ?? this.settings.get('quota.defaultJudgingMs'),
      storageBytes:
        row?.quotaStorageBytes ??
        this.settings.get('quota.defaultStorageBytes'),
    };
  }

  async limitsOf(organizationId: string): Promise<EffectiveLimits> {
    const row = await this.organizations
      .findById(organizationId, {
        quotaMonthlyCredits: 1,
        quotaJudgingMs: 1,
        quotaStorageBytes: 1,
        quotaUnlimited: 1,
      })
      .lean()
      .exec();
    return this.limitsFrom(row);
  }

  async record(
    key: UsageKey,
    reason: OrganizationCreditEntry['reason'],
    charge: PricedCharge,
  ): Promise<void> {
    await this.ledger.create({
      organization: key.organizationId,
      month: key.month,
      reason,
      amount: charge.amount,
      user: charge.userId,
      ref: charge.ref,
    });
  }

  /** Lowers the counter by `amount` unless it is already lower (the guard); true when it did. */
  async giveBack(key: UsageKey, amount: number): Promise<boolean> {
    const { matchedCount } = await this.usage
      .updateOne(
        {
          organization: key.organizationId,
          month: key.month,
          creditsUsed: { $gte: amount },
        },
        { $inc: { creditsUsed: -amount } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Gives the credits back after failed work and logs a `refund` row only if the counter really moved; never masks the work's own error. */
  async refund(key: UsageKey, charge: PricedCharge): Promise<void> {
    try {
      await this.giveBackAndRecord(key, charge);
    } catch (error) {
      this.logger.error(
        `Refund of ${charge.amount} credits to ${key.organizationId} failed: ${(error as Error).message}`,
      );
    }
  }

  /** `refund` at most once per `claim` (a job id), however often the failure is handled; a refund that fails releases the claim so a retry can redo it. False when it was already claimed. */
  async refundOnce(claim: string, spent: SpentCharge): Promise<boolean> {
    const claimKey = `quota:refund:${claim}`;
    const claimed = await this.redis.set(
      claimKey,
      '1',
      'EX',
      REFUND_CLAIM_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') return false;
    try {
      await this.giveBackAndRecord(spent, spent);
    } catch (error) {
      await this.redis.del(claimKey);
      throw error;
    }
    return true;
  }

  /** The one reader of stored bytes: what the organization's private problems hold (see `sumStoredBytesByOrganization`). */
  async usedStorageBytes(organizationId: string): Promise<number> {
    const sums = await this.usedStorageBytesOf([organizationId]);
    return sums.get(organizationId) ?? 0;
  }

  /** `usedStorageBytes` for a page of organizations; one with nothing stored is absent from the map. */
  usedStorageBytesOf(
    organizationIds: readonly string[],
  ): Promise<Map<string, number>> {
    return sumStoredBytesByOrganization(this.problems, organizationIds);
  }

  /** The judging meter: the sum of the organization's judging charges in `month`. */
  async usedJudgingMs(organizationId: string, month: string): Promise<number> {
    const [sum] = await this.judgingCharges.aggregate<{ ms: number }>([
      { $match: { organization: toUuid(organizationId), month } },
      { $group: { _id: null, ms: { $sum: '$ms' } } },
    ]);
    return sum?.ms ?? 0;
  }

  /** The `limit` problems that used the most judging time of the organization in `month`, heaviest first; a problem that no longer exists, or that `visible` (a `ProblemAccess.visibleFilter`) does not match, is left out before the limit, so it takes no row. */
  topProblems(
    organizationId: string,
    month: string,
    limit: number,
    visible: FilterQuery<Problem>,
  ): Promise<ProblemJudgingTime[]> {
    // `$match` does not cast ids, so the filter is cast first.
    const match = this.problems
      .find()
      .cast(this.problems, visible) as FilterQuery<Problem>;
    return this.judgingCharges.aggregate<ProblemJudgingTime>([
      { $match: { organization: toUuid(organizationId), month } },
      { $group: { _id: '$problem', ms: { $sum: '$ms' }, runs: { $sum: 1 } } },
      {
        $lookup: {
          from: this.problems.collection.name,
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $match: match }, { $project: { code: 1, name: 1 } }],
          as: 'problem',
        },
      },
      { $unwind: '$problem' },
      { $sort: { ms: -1, _id: 1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          code: '$problem.code',
          name: '$problem.name',
          ms: 1,
          runs: 1,
        },
      },
    ]);
  }

  /** The storage meter: reads what the organization holds and checks that `addedBytes` (what this write adds; negative or zero always fits) stays within its limit. Enforce refuses with 403 `quota_exceeded`; warn logs. */
  async assertStorage(
    organizationId: string,
    addedBytes: number,
  ): Promise<void> {
    if (addedBytes <= 0) return;
    const { storageBytes: limit, unlimited } =
      await this.limitsOf(organizationId);
    if (unlimited) return;
    const usedBytes = await this.usedStorageBytes(organizationId);
    if (usedBytes + addedBytes <= limit) return;
    if (await this.isEnforcing())
      throw quotaExceeded({
        meter: 'storage',
        limit,
        used: usedBytes,
        needed: addedBytes,
      });
    this.logger.warn(
      `Organization ${organizationId} is over its storage limit: ${usedBytes}+${addedBytes}/${limit}`,
    );
  }

  private async giveBackAndRecord(
    key: UsageKey,
    charge: PricedCharge,
  ): Promise<void> {
    if (await this.giveBack(key, charge.amount))
      await this.record(key, 'refund', { ...charge, amount: -charge.amount });
  }
}

/** 403 with an `issues[]` entry on the exhausted meter (`credits` or `storage`), so clients read it like a field error; `details` carries the numbers. */
export const quotaExceeded = (details: QuotaRefusal): AppError => {
  const message = `The organization has no ${details.meter} left`;
  return new AppError('quota_exceeded', 403, message, undefined, undefined, {
    details,
    issues: [{ field: details.meter, code: 'quota_exceeded', message }],
  });
};

/** The refusal's numbers, when `error` is a quota refusal. */
export const quotaRefusalOf = (error: unknown): QuotaRefusal | null =>
  error instanceof AppError && error.code === 'quota_exceeded'
    ? ((error.extra as { details?: QuotaRefusal } | undefined)?.details ?? null)
    : null;
