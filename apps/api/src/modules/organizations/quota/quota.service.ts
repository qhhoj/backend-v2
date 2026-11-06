import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { OrganizationUsage } from '@libs/database';
import { QuotaLedger, quotaExceeded } from '@libs/problems';
import type {
  ChargeRequest,
  PricedCharge,
  SpentCharge,
  UsageKey,
} from '@libs/problems';
import { SettingsService } from '@libs/settings';
import { meterOf } from './quota-meter';
import { QuotaWarningNotifier } from './quota-warning.notifier';
import { BYTES_PER_COST_UNIT } from './quota.constants';
import type { QuotaSnapshot } from './quota.types';

/** Monthly credits (atomic, refundable) of an organization, its 80% warnings and its usage snapshot; limits, enforce mode and the storage meter live in `QuotaLedger`. `warn` mode lets everything through but logs and counts, so a site can measure before it blocks. */
@Injectable()
export class QuotaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly ledger: QuotaLedger,
    @InjectModel(OrganizationUsage.name)
    private readonly usage: Model<OrganizationUsage>,
    private readonly warnings: QuotaWarningNotifier,
  ) {}

  /** Enforcing waits for the size backfill, which only `worker migrate` runs (the deploy runs it before each restart). */
  async onApplicationBootstrap(): Promise<void> {
    if (this.settings.get('quota.enforce') !== 'enforce') return;
    if (!(await this.ledger.isStorageBackfilled()))
      this.logger.warn(
        'quota.enforce is "enforce" but the size backfill has not run: quotas stay in warn mode until `worker migrate` has run',
      );
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

  /** Spends first, runs `work` (given what was spent, null when free), refunds when `work` throws. Call it AFTER the request is validated so a bad request costs nothing. A null organization (superuser, nothing to charge) and a zero price run `work` free. With `refundClaim` the refund goes through `refundOnce`, so whoever else may give the same charge back (a chunked upload's held charge) gives it back once in all. */
  async charged<Result>(
    organizationId: string | null,
    request: ChargeRequest,
    work: (spent: SpentCharge | null) => Promise<Result>,
    options: { now?: Date; refundClaim?: string } = {},
  ): Promise<Result> {
    const { now = new Date(), refundClaim } = options;
    const amount = organizationId === null ? 0 : this.priceOf(request);
    if (organizationId === null || amount === 0) return work(null);
    const key = { organizationId, month: this.ledger.monthKeyOf(now) };
    const charge = { ...request, amount };
    await this.spend(key, charge);
    let result: Result;
    try {
      result = await work({ ...key, ...charge });
    } catch (error) {
      await this.refundFailed({ ...key, ...charge }, refundClaim);
      throw error;
    }
    await this.warnIfCreditsNear(key);
    return result;
  }

  /** Never masks the work's own error: a failed claimed refund is logged like `QuotaLedger.refund` logs its own. */
  private async refundFailed(
    spent: SpentCharge,
    refundClaim: string | undefined,
  ): Promise<void> {
    if (refundClaim === undefined) return this.ledger.refund(spent, spent);
    try {
      await this.ledger.refundOnce(refundClaim, spent);
    } catch (error) {
      this.logger.error(
        `Refund of ${spent.amount} credits to ${spent.organizationId} failed: ${(error as Error).message}`,
      );
    }
  }

  /** Refuses (403 `quota_exceeded`) a charge this month's credits can no longer cover, spending nothing: a check before slow work (a chunked upload's create). `charged` stays the authority. */
  async assertAffordable(
    organizationId: string | null,
    request: ChargeRequest,
    now = new Date(),
  ): Promise<void> {
    if (organizationId === null) return;
    const amount = this.priceOf(request);
    const { credits: limit, unlimited } =
      await this.ledger.limitsOf(organizationId);
    if (amount === 0 || unlimited || !(await this.ledger.isEnforcing())) return;
    const key = { organizationId, month: this.ledger.monthKeyOf(now) };
    if ((await this.creditsUsed(key)) + amount > limit)
      throw await this.refusalFor(key, limit, amount);
  }

  /** The once-a-month 80% credit warning; it sits outside the refund `try`, so a failure here can never refund finished work, and it is caught so it never fails the request whose work is done. */
  private async warnIfCreditsNear(key: UsageKey): Promise<void> {
    try {
      const { credits, unlimited } = await this.ledger.limitsOf(
        key.organizationId,
      );
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

  /** The storage meter's counterpart: called after a data write, reads the organization's new total and warns its admins once it passes 80%. Never throws: the write is done, a failed warning is only logged. */
  async afterStorageWrite(
    organizationId: string,
    now = new Date(),
  ): Promise<void> {
    try {
      const { storageBytes, unlimited } =
        await this.ledger.limitsOf(organizationId);
      if (unlimited) return;
      const used = await this.ledger.usedStorageBytes(organizationId);
      if (!meterOf(used, storageBytes).isNearLimit) return;
      const key = { organizationId, month: this.ledger.monthKeyOf(now) };
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
    const { credits: limit, unlimited } = await this.ledger.limitsOf(
      key.organizationId,
    );
    const enforcing = !unlimited && (await this.ledger.isEnforcing());
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

  /** The organization's month: credits, judging time and storage against their limits. */
  async snapshot(
    organizationId: string,
    now = new Date(),
  ): Promise<QuotaSnapshot> {
    const month = this.ledger.monthKeyOf(now);
    const [limits, creditsUsed, judgingMs, usedBytes, enforcing] =
      await Promise.all([
        this.ledger.limitsOf(organizationId),
        this.creditsUsed({ organizationId, month }),
        this.ledger.usedJudgingMs(organizationId, month),
        this.ledger.usedStorageBytes(organizationId),
        this.ledger.isEnforcing(),
      ]);
    return {
      month,
      enforcing,
      unlimited: limits.unlimited,
      credits: meterOf(creditsUsed, limits.credits, limits.unlimited),
      judging: meterOf(judgingMs, limits.judgingMs, limits.unlimited),
      storage: meterOf(usedBytes, limits.storageBytes, limits.unlimited),
    };
  }
}
