import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from '@libs/database';
import type { Model } from 'mongoose';

/** The v2 go-live (2026-10-10T00:00+07:00): every account that joined earlier was migrated from the old site. */
export const V2_GO_LIVE = new Date('2026-10-09T17:00:00.000Z');

/**
 * Accounts from before `passwordSetBeforeVerification` existed whose password may predate a proven mailbox, with a
 * usable password and no social link: every one that joined after the go-live (signup or staff creation), and a
 * migrated one never activated (it can still be activated through v2's flow). Neither a reset confirm nor a staff
 * password set is recorded on the account, so those are counted as not having happened.
 */
export const PASSWORD_VERIFICATION_BACKFILL_FILTER = {
  passwordSetBeforeVerification: { $exists: false },
  $or: [{ dateJoined: { $gte: V2_GO_LIVE } }, { isActive: false }],
  password: { $not: /^!/ },
  'socialAuth.0': { $exists: false },
};

/** One-off data migration, idempotent, run by the api before it listens: flags the accounts above, then writes false on every other account without the field, so later boots match nothing; `updatedAt` stays the time of the last real edit. */
@Injectable()
export class PasswordVerificationBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(
    PasswordVerificationBackfillService.name,
  );

  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async onApplicationBootstrap(): Promise<void> {
    const { flagged, cleared } = await this.backfill();
    if (flagged || cleared)
      this.logger.log(
        `passwordSetBeforeVerification: ${flagged} set, ${cleared} false`,
      );
  }

  async backfill(): Promise<{ flagged: number; cleared: number }> {
    const flagged = await this.users
      .updateMany(
        PASSWORD_VERIFICATION_BACKFILL_FILTER,
        { $set: { passwordSetBeforeVerification: true } },
        { timestamps: false },
      )
      .exec();
    const cleared = await this.users
      .updateMany(
        { passwordSetBeforeVerification: { $exists: false } },
        { $set: { passwordSetBeforeVerification: false } },
        { timestamps: false },
      )
      .exec();
    return { flagged: flagged.modifiedCount, cleared: cleared.modifiedCount };
  }
}
