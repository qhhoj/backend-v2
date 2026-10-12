import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { AppError, isDuplicateKey, REDIS } from '@libs/common';
import { OrganizationUsage } from '@libs/database';
import { QuotaLedger, quotaExceeded } from '@libs/problems';
import type {
  ChargeRequest,
  EffectiveLimits,
  PricedCharge,
  SpentCharge,
  UsageKey,
} from '@libs/problems';
import { SettingsService } from '@libs/settings';
import { meterOf } from './quota-meter';
import { QuotaWarningNotifier } from './quota-warning.notifier';
import {
  BYTES_PER_COST_UNIT,
  QUOTA_BACKFILL_DONE_KEY,
} from './quota.constants';
import type { QuotaSnapshot } from './quota.types';

/** Monthly credits (atomic, refundable) and the storage meter of an organization; the primitives the worker shares live in `QuotaLedger`. `warn` mode lets everything through but logs and counts, so a site can measure before it blocks. */
@Injectable()
export class QuotaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly ledger: QuotaLedger,
    @InjectModel(OrganizationUsage.name)
    private readonly usage: Model<OrganizationUsage>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly warnings: QuotaWarningNotifier,
  ) {}

  /** The backfill flag lives in Redis only, so a Redis flush or restart silently turns `enforce` back into `warn`: say so at boot (re-run the backfill by removing the job `problem-databytes-backfill-v1` from the `problem-databytes` queue and restarting the worker). */
  async onApplicationBootstrap(): Promise<void> {
    if (this.settings.get('quota.enforce') !== 'enforce') return;
    if ((await this.redis.get(QUOTA_BACKFILL_DONE_KEY)) !== '1')
      this.logger.warn(
        'quota.enforce is "enforce" but the dataBytes backfill flag is missing: quotas stay in warn mode until the backfill job has run again',
      );
  }

  isEnforcing(): Promise<boolean> {
    return this.ledger.isEnforcing();
  }

  monthKeyOf(now: Date): string {
    return this.ledger.monthKeyOf(now);
  }

  limitsFrom(row: Parameters<QuotaLedger['limitsFrom']>[0]): EffectiveLimits {
    return this.ledger.limitsFrom(row);
  }

  limitsOf(organizationId: string): Promise<EffectiveLimits> {
    return this.ledger.limitsOf(organizationId);
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

  /** Spends first, runs `work` (given what was spent, null when free), refunds when `work` throws. Call it AFTER the request is validated so a bad request costs nothing. A null organization (superuser, nothing to charge) and a zero price run `work` free. */
  async charged<Result>(
    organizationId: string | null,
    request: ChargeRequest,
    work: (spent: SpentCharge | null) => Promise<Result>,
    now = new Date(),
  ): Promise<Result> {
    const amount = organizationId === null ? 0 : this.priceOf(request);
    if (organizationId === null || amount === 0) return work(null);
    const key = { organizationId, month: this.monthKeyOf(now) };
    const charge = { ...request, amount };
    await this.spend(key, charge);
    let result: Result;
    try {
      result = await work({ ...key, ...charge });
    } catch (error) {
      await this.ledger.refund(key, charge);
      throw error;
    }
    await this.warnIfCreditsNear(key);
    return result;
  }

  /** The once-a-month 80% credit warning; it sits outside the refund `try`, so a failure here can never refund finished work, and it is caught so it never fails the request whose work is done. */
  private async warnIfCreditsNear(key: UsageKey): Promise<void> {
    try {
      const { credits, unlimited } = await this.limitsOf(key.organizationId);
      if (unlimited) return;
      const used = await this.creditsUsed(key);
      if (meterOf(used, credits).isNearLimit)
        await this.warnings.warnOnce(key, 'credits');
    } catch (error) {
      this.logger.error(
        `Credit warning for ${key.organizationId} failed: ${(error as Error).message}`,
      );
    }
  }

  /** The storage meter's counterpart: called after a data write with the organization's new total (or a function reading it). Never throws: the write is done, a failed warning is only logged. */
  async afterStorageWrite(
    organizationId: string,
    usedBytes: number | (() => Promise<number>),
    now = new Date(),
  ): Promise<void> {
    try {
      const used =
        typeof usedBytes === 'number' ? usedBytes : await usedBytes();
      const { storageBytes, unlimited } = await this.limitsOf(organizationId);
      if (unlimited || !meterOf(used, storageBytes).isNearLimit) return;
      const key = { organizationId, month: this.monthKeyOf(now) };
      await this.ensureUsageRow(key);
      await this.warnings.warnOnce(key, 'storage');
    } catch (error) {
      this.logger.error(
        `Storage warning for ${organizationId} failed: ${(error as Error).message}`,
      );
    }
  }

  /** The atomic spend. (1) In enforce mode a price above the limit is refused up front. (2) An upsert with `$setOnInsert` only creates the month's row, so it can never hit a duplicate key on an over-limit month. (3) A guarded `$inc` without upsert applies the limit, including on the month's first spend; a miss is `quota_exceeded`. */
  private async spend(key: UsageKey, charge: PricedCharge): Promise<void> {
    const { credits: limit, unlimited } = await this.limitsOf(
      key.organizationId,
    );
    const enforcing = !unlimited && (await this.isEnforcing());
    if (enforcing && charge.amount > limit)
      throw await this.refusalFor(key, limit, charge.amount);
    await this.ensureUsageRow(key);
    const used = await this.reserve(
      key,
      charge.amount,
      enforcing ? limit : null,
    );
    if (used === null) throw await this.refusalFor(key, limit, charge.amount);
    if (!unlimited && used > limit)
      this.logger.warn(
        `Organization ${key.organizationId} is over its credit limit in ${key.month}: ${used}/${limit}`,
      );
    await this.recordOrGiveBack(key, charge);
  }

  /** The ledger row is the audit trail of the counter: if it cannot be written, the credits just taken go back so counter and ledger never drift. */
  private async recordOrGiveBack(
    key: UsageKey,
    charge: PricedCharge,
  ): Promise<void> {
    try {
      await this.ledger.record(key, charge.kind, charge);
    } catch (error) {
      await this.ledger.giveBack(key, charge.amount);
      throw error;
    }
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

  /** The storage meter (see `QuotaLedger.assertStorage`); the caller sums `usedBytes` from the problems it owns (`ProblemsRepository.sumStoredBytes`). */
  assertStorage(
    organizationId: string,
    bytes: { usedBytes: number; addedBytes: number },
  ): Promise<void> {
    return this.ledger.assertStorage(organizationId, bytes);
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
      unlimited: limits.unlimited,
      credits: meterOf(creditsUsed, limits.credits, limits.unlimited),
      storage: meterOf(usedBytes, limits.storageBytes, limits.unlimited),
    };
  }
}
