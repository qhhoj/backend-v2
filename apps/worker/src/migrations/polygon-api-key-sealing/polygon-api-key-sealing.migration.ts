import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { decrypt, encryptionKey, ENV } from '@libs/common';
import type { WorkerConfig } from '@libs/common';
import { Setting, SettingRevision } from '@libs/database';
import { SETTINGS, sealSetting, shownRevisionValue } from '@libs/settings';
import type { Model } from 'mongoose';
import type { Migration } from '../migration';

const KEY = 'polygon.apiKey';
const definition = SETTINGS[KEY];

/** Canonical base64, as `encrypt` writes it. */
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** iv (12) + tag (16) + the JSON quotes of an empty string (2): the shortest value `sealSetting` writes. */
const MIN_SEALED_BYTES = 30;

/**
 * Whether `stored` has the shape of a sealed value, whatever key sealed it, so a value sealed under another
 * `ENCRYPTION_KEY` is never sealed again. A Polygon key (40 lowercase hex characters) is valid base64 of 30 bytes, so
 * an all-lowercase-hex value counts as plain: a ciphertext that long is all lowercase hex with odds below 1e-18.
 */
export const looksSealed = (stored: string): boolean =>
  BASE64.test(stored) &&
  Buffer.from(stored, 'base64').length >= MIN_SEALED_BYTES &&
  !/^[0-9a-f]*$/.test(stored);

/**
 * `polygon.apiKey` was stored plain before it became a secret (`storedPlainBefore`): seals a plain stored value, and
 * redacts plain revision values to what the admin already sees (`shownRevisionValue`). Each write compares the value
 * it read.
 */
@Injectable()
export class PolygonApiKeySealingMigration implements Migration {
  readonly id = '2026-11-06-polygon-api-key-sealing';
  private readonly logger = new Logger(PolygonApiKeySealingMigration.name);
  private readonly key: Buffer;

  constructor(
    @Inject(ENV) env: WorkerConfig,
    @InjectModel(Setting.name) private readonly settings: Model<Setting>,
    @InjectModel(SettingRevision.name)
    private readonly revisions: Model<SettingRevision>,
  ) {
    this.key = encryptionKey(env.encryptionKey);
  }

  async run(): Promise<number> {
    return (await this.sealStoredKey()) + (await this.redactRevisions());
  }

  /** Seals the stored value only when it is plain and a valid key; anything else is left for the reader as it is. */
  private async sealStoredKey(): Promise<number> {
    const row = await this.settings.collection.findOne({ _id: KEY as never });
    const stored: unknown = row?.value;
    if (typeof stored !== 'string') return 0;
    if (looksSealed(stored)) {
      if (!this.opens(stored))
        this.logger.warn(
          `${KEY} looks sealed but does not open with this ENCRYPTION_KEY; left as is`,
        );
      return 0;
    }
    if (!this.isValidKey(stored)) return 0;
    const { modifiedCount } = await this.settings.collection.updateOne(
      { _id: KEY as never, value: stored },
      { $set: { value: sealSetting(definition, stored, this.key) } },
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

  private isValidKey(stored: string): boolean {
    try {
      definition.type.parse(stored);
      return true;
    } catch {
      return false;
    }
  }

  private opens(stored: string): boolean {
    try {
      decrypt(stored, this.key);
      return true;
    } catch {
      return false;
    }
  }
}
