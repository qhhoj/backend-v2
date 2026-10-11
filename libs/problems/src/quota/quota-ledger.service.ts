import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { AppError, monthKeyIn, REDIS } from '@libs/common';
import {
  Organization,
  OrganizationCreditEntry,
  OrganizationUsage,
  Problem,
} from '@libs/database';
import { SettingsService } from '@libs/settings';
import { QUOTA_BACKFILL_DONE_KEY } from '../quota-queues';
import { sumDataBytesByOrganization } from './organization-storage';
import type {
  EffectiveLimits,
  PricedCharge,
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
    return monthKeyIn(this.settings.get('site.timeZone'), now);
  }

  /** The effective limits of an organization row: its own caps, else the site defaults. */
  limitsFrom(
    row: {
      quotaMonthlyCredits?: number | null;
      quotaStorageBytes?: number | null;
      quotaUnlimited?: boolean;
    } | null,
  ): EffectiveLimits {
    return {
      unlimited: row?.quotaUnlimited ?? false,
      credits:
        row?.quotaMonthlyCredits ??
        this.settings.get('quota.defaultMonthlyCredits'),
      storageBytes:
        row?.quotaStorageBytes ??
        this.settings.get('quota.defaultStorageBytes'),
    };
  }

  async limitsOf(organizationId: string): Promise<EffectiveLimits> {
    const row = await this.organizations
      .findById(organizationId, {
        quotaMonthlyCredits: 1,
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

  /** Bytes the organization's private problems hold (see `sumDataBytesByOrganization`). */
  async usedStorageBytes(organizationId: string): Promise<number> {
    const sums = await sumDataBytesByOrganization(this.problems, [
      organizationId,
    ]);
    return sums.get(organizationId) ?? 0;
  }

  /** The storage meter. `usedBytes` is the organization's current total, `addedBytes` what this write adds (negative or zero always fits). Enforce refuses with 403 `quota_exceeded`; warn logs. */
  async assertStorage(
    organizationId: string,
    bytes: { usedBytes: number; addedBytes: number },
  ): Promise<void> {
    const { usedBytes, addedBytes } = bytes;
    if (addedBytes <= 0) return;
    const { storageBytes: limit, unlimited } =
      await this.limitsOf(organizationId);
    if (unlimited || usedBytes + addedBytes <= limit) return;
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
