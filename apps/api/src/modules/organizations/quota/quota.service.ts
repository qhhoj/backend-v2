import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { AppError, isDuplicateKey, monthKeyIn, REDIS } from '@libs/common';
import {
  Organization,
  OrganizationCreditEntry,
  OrganizationUsage,
} from '@libs/database';
import { SettingsService } from '@libs/settings';
import { meterOf } from './quota-meter';
import {
  BYTES_PER_COST_UNIT,
  QUOTA_BACKFILL_DONE_KEY,
} from './quota.constants';
import type { ChargeRequest, QuotaRefusal, QuotaSnapshot } from './quota.types';

interface UsageKey {
  organizationId: string;
  month: string;
}

type PricedCharge = ChargeRequest & { amount: number };

/** Monthly credits (atomic, refundable) and the storage meter of an organization. `warn` mode lets everything through but logs and counts, so a site can measure before it blocks. */
@Injectable()
export class QuotaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(OrganizationUsage.name)
    private readonly usage: Model<OrganizationUsage>,
    @InjectModel(OrganizationCreditEntry.name)
    private readonly ledger: Model<OrganizationCreditEntry>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** The backfill flag lives in Redis only, so a Redis flush or restart silently turns `enforce` back into `warn`: say so at boot (re-run the backfill by removing the job `problem-databytes-backfill-v1` from the `problem-databytes` queue and restarting the worker). */
  async onApplicationBootstrap(): Promise<void> {
    if (this.settings.get('quota.enforce') !== 'enforce') return;
    if ((await this.redis.get(QUOTA_BACKFILL_DONE_KEY)) !== '1')
      this.logger.warn(
        'quota.enforce is "enforce" but the dataBytes backfill flag is missing: quotas stay in warn mode until the backfill job has run again',
      );
  }

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
    } | null,
  ): { credits: number; storageBytes: number } {
    return {
      credits:
        row?.quotaMonthlyCredits ??
        this.settings.get('quota.defaultMonthlyCredits'),
      storageBytes:
        row?.quotaStorageBytes ??
        this.settings.get('quota.defaultStorageBytes'),
    };
  }

  async limitsOf(
    organizationId: string,
  ): Promise<{ credits: number; storageBytes: number }> {
    const row = await this.organizations
      .findById(organizationId, {
        quotaMonthlyCredits: 1,
        quotaStorageBytes: 1,
      })
      .lean()
      .exec();
    return this.limitsFrom(row);
  }

  priceOf(request: ChargeRequest): number {
    if (request.kind === 'problem')
      return this.settings.get('quota.cost.problem');
    if (request.kind === 'contest')
      return this.settings.get('quota.cost.contest');
    return (
      Math.ceil((request.bytes ?? 0) / BYTES_PER_COST_UNIT) *
      this.settings.get('quota.cost.dataPer10MiB')
    );
  }

  /** Spends first, runs `work`, refunds when `work` throws. Call it AFTER the request is validated so a bad request costs nothing. A null organization (superuser, nothing to charge) and a zero price run `work` free. */
  async charged<Result>(
    organizationId: string | null,
    request: ChargeRequest,
    work: () => Promise<Result>,
    now = new Date(),
  ): Promise<Result> {
    const amount = organizationId === null ? 0 : this.priceOf(request);
    if (organizationId === null || amount === 0) return work();
    const key = { organizationId, month: this.monthKeyOf(now) };
    const charge = { ...request, amount };
    await this.spend(key, charge);
    try {
      return await work();
    } catch (error) {
      await this.refund(key, charge);
      throw error;
    }
  }

  /** The atomic spend. (1) In enforce mode a price above the limit is refused up front. (2) An upsert with `$setOnInsert` only creates the month's row, so it can never hit a duplicate key on an over-limit month. (3) A guarded `$inc` without upsert applies the limit, including on the month's first spend; a miss is `quota_exceeded`. */
  private async spend(key: UsageKey, charge: PricedCharge): Promise<void> {
    const { credits: limit } = await this.limitsOf(key.organizationId);
    const enforcing = await this.isEnforcing();
    if (enforcing && charge.amount > limit)
      throw await this.refusalFor(key, limit, charge.amount);
    await this.ensureUsageRow(key);
    const used = await this.reserve(
      key,
      charge.amount,
      enforcing ? limit : null,
    );
    if (used === null) throw await this.refusalFor(key, limit, charge.amount);
    if (used > limit)
      this.logger.warn(
        `Organization ${key.organizationId} is over its credit limit in ${key.month}: ${used}/${limit}`,
      );
    await this.record(key, charge.kind, charge);
  }

  private async ensureUsageRow(key: UsageKey): Promise<void> {
    const upsert = () =>
      this.usage
        .updateOne(
          { organization: key.organizationId, month: key.month },
          { $setOnInsert: { creditsUsed: 0 } },
          { upsert: true },
        )
        .exec();
    try {
      await upsert();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      await upsert();
    }
  }

  /** Step three: the new counter, or null when the guard (`creditsUsed <= limit - amount`) refused. A null `limit` (warn mode) skips the guard. */
  private async reserve(
    key: UsageKey,
    amount: number,
    limit: number | null,
  ): Promise<number | null> {
    const guard =
      limit === null ? {} : { creditsUsed: { $lte: limit - amount } };
    const row = await this.usage
      .findOneAndUpdate(
        { organization: key.organizationId, month: key.month, ...guard },
        { $inc: { creditsUsed: amount } },
        { new: true },
      )
      .lean()
      .exec();
    return row?.creditsUsed ?? null;
  }

  private async record(
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

  /** Gives the credits back when the guarded write failed; never masks the write's own error. */
  private async refund(key: UsageKey, charge: PricedCharge): Promise<void> {
    try {
      await this.usage
        .updateOne(
          {
            organization: key.organizationId,
            month: key.month,
            creditsUsed: { $gte: charge.amount },
          },
          { $inc: { creditsUsed: -charge.amount } },
        )
        .exec();
      await this.record(key, 'refund', { ...charge, amount: -charge.amount });
    } catch (error) {
      this.logger.error(
        `Refund of ${charge.amount} credits to ${key.organizationId} failed: ${(error as Error).message}`,
      );
    }
  }

  async creditsUsed(key: UsageKey): Promise<number> {
    const row = await this.usage
      .findOne(
        { organization: key.organizationId, month: key.month },
        { creditsUsed: 1 },
      )
      .lean()
      .exec();
    return row?.creditsUsed ?? 0;
  }

  private async refusalFor(
    key: UsageKey,
    limit: number,
    needed: number,
  ): Promise<AppError> {
    return quotaExceeded({
      meter: 'credits',
      limit,
      used: await this.creditsUsed(key),
      needed,
    });
  }

  /** The storage meter. `usedBytes` is the organization's current total (the caller sums it from the problems it owns, see `ProblemsRepository.sumDataBytes`), `addedBytes` what this write adds (negative or zero always fits). Enforce refuses; warn logs. */
  async assertStorage(
    organizationId: string,
    bytes: { usedBytes: number; addedBytes: number },
  ): Promise<void> {
    const { usedBytes, addedBytes } = bytes;
    if (addedBytes <= 0) return;
    const { storageBytes: limit } = await this.limitsOf(organizationId);
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

  async snapshot(
    organizationId: string,
    usedBytes: number,
    now = new Date(),
  ): Promise<QuotaSnapshot> {
    const month = this.monthKeyOf(now);
    const [limits, creditsUsed, enforcing] = await Promise.all([
      this.limitsOf(organizationId),
      this.creditsUsed({ organizationId, month }),
      this.isEnforcing(),
    ]);
    return {
      month,
      enforcing,
      credits: meterOf(creditsUsed, limits.credits),
      storage: meterOf(usedBytes, limits.storageBytes),
    };
  }
}

const quotaExceeded = (details: QuotaRefusal): AppError =>
  new AppError(
    'quota_exceeded',
    403,
    `The organization has no ${details.meter} left`,
    undefined,
    undefined,
    { details },
  );
