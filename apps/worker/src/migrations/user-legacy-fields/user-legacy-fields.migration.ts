import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from '@libs/database';
import type { Model } from 'mongoose';
import { fillMissing } from '../fill-missing';
import type { Migration } from '../migration';

/**
 * User fields rows migrated from the old site, or written before the field existed, hold half-filled. Each write is
 * the value the tolerant read already takes (L24 drops those reads):
 * - `lastTotpTimecode` missing or null is 0 (`advanceTotpTimecode`'s `$in: [0, null]`);
 * - `socialAuth` missing is no link;
 * - a TOTP flag without a key is not enrolled (`isTotpEnrolled`), so the flag is cleared; a confirm sets key and flag
 *   together, so a row it wrote no longer matches;
 * - a ban from before `isActiveBeforeBan` existed unbans to active (`?? true`); outside a ban the field is null.
 */
@Injectable()
export class UserLegacyFieldsMigration implements Migration {
  readonly id = '2026-11-06-user-legacy-fields';

  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async run(): Promise<number> {
    const users = this.users.collection;
    const writes = await Promise.all([
      users.updateMany(
        { lastTotpTimecode: null },
        { $set: { lastTotpTimecode: 0 } },
      ),
      users.updateMany(
        { isTotpEnabled: true, totpKey: { $in: [null, ''] } },
        { $set: { isTotpEnabled: false } },
      ),
      users.updateMany(
        { banReason: { $ne: null }, isActiveBeforeBan: null },
        { $set: { isActiveBeforeBan: true } },
      ),
    ]);
    const filled =
      (await fillMissing(users, { socialAuth: [] })) +
      (await fillMissing(
        users,
        { isActiveBeforeBan: null },
        { banReason: null },
      ));
    return writes.reduce((sum, write) => sum + write.modifiedCount, filled);
  }
}
