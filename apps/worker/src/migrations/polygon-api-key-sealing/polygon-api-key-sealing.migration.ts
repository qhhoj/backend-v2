import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { decrypt, encryptionKey, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { Setting, SettingRevision } from '@libs/database';
import {
  SETTINGS,
  openSetting,
  sealSetting,
  shownRevisionValue,
} from '@libs/settings';
import type { Model } from 'mongoose';
import type { Migration } from '../migration';

const KEY = 'polygon.apiKey';
const definition = SETTINGS[KEY];

/**
 * `polygon.apiKey` was stored plain before it became a secret (`storedPlainBefore`): seals a plain stored value, and
 * redacts plain revision values to what the admin already sees (`shownRevisionValue`). Each write compares the value
 * it read; a sealed value opens with the key, a plain one does not.
 */
@Injectable()
export class PolygonApiKeySealingMigration implements Migration {
  readonly id = '2026-11-06-polygon-api-key-sealing';
  private readonly key: Buffer;

  constructor(
    @Inject(ENV) env: Env,
    @InjectModel(Setting.name) private readonly settings: Model<Setting>,
    @InjectModel(SettingRevision.name)
    private readonly revisions: Model<SettingRevision>,
  ) {
    this.key = encryptionKey(env.encryptionKey);
  }

  async run(): Promise<number> {
    return (await this.sealSetting()) + (await this.redactRevisions());
  }

  private async sealSetting(): Promise<number> {
    const row = await this.settings.collection.findOne({ _id: KEY as never });
    if (typeof row?.value !== 'string' || this.isSealed(row.value)) return 0;
    const value = openSetting(KEY, definition, row.value, this.key);
    const { modifiedCount } = await this.settings.collection.updateOne(
      { _id: KEY as never, value: row.value },
      { $set: { value: sealSetting(definition, value, this.key) } },
    );
    return modifiedCount;
  }

  private async redactRevisions(): Promise<number> {
    let redacted = 0;
    const rows = this.revisions.collection.find(
      { key: KEY },
      { projection: { before: 1, after: 1 } },
    );
    for await (const { _id, before, after } of rows) {
      const shown = {
        before: shownRevisionValue(definition, before),
        after: shownRevisionValue(definition, after),
      };
      if (shown.before === before && shown.after === after) continue;
      const { modifiedCount } = await this.revisions.collection.updateOne(
        { _id, before, after },
        { $set: shown },
      );
      redacted += modifiedCount;
    }
    return redacted;
  }

  private isSealed(stored: string): boolean {
    try {
      decrypt(stored, this.key);
      return true;
    } catch {
      return false;
    }
  }
}
