import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Setting } from '@libs/database';
import type { Connection, Model } from 'mongoose';
import { definitionOf, SETTINGS } from './registry';
import type { SettingKey, SettingValue } from './registry';
import {
  changedFields,
  readSetting,
  redactSetting,
  sealSetting,
} from './sealing';
import { SETTINGS_KEY } from './settings-key';
import { SettingRevisionsRepository } from './setting-revisions.repository';
import { SettingsQuerier } from './settings.querier';

@Injectable()
export class SettingsService {
  constructor(
    private readonly querier: SettingsQuerier,
    private readonly revisions: SettingRevisionsRepository,
    @InjectModel(Setting.name) private readonly settings: Model<Setting>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SETTINGS_KEY) private readonly key: Buffer,
  ) {}

  /** The current value, from memory: cheap enough to call on every request. */
  get<Key extends SettingKey>(key: Key): SettingValue<Key> {
    return this.querier.get(key);
  }

  /**
   * Combines `patch` with the stored value, validates, seals, upserts and writes the redacted revision in one transaction (a write conflict retries the callback), so parallel patches of one setting cannot lose a field.
   * Throws `SettingError` for an invalid result; nothing is written then.
   */
  async set(
    key: SettingKey,
    patch: unknown,
    actorId: string | null,
  ): Promise<void> {
    const definition = SETTINGS[key];
    let next: unknown;
    await this.connection.transaction(async (session) => {
      const row = await this.settings.findById(key).session(session).lean();
      const before = row
        ? this.readOrDefault(key, row.value)
        : definition.default;
      next = definition.type.parse(
        definition.combine ? definition.combine(before as never, patch) : patch,
      );
      await this.settings.updateOne(
        { _id: key },
        {
          $set: {
            value: sealSetting(definition, next, this.key),
            updatedBy: actorId,
            updatedAt: new Date(),
          },
        },
        { upsert: true, session },
      );
      await this.revisions.create(
        {
          key,
          before: redactSetting(definition, before),
          after: redactSetting(definition, next),
          changedFields: changedFields(before, next),
          actor: actorId,
        },
        session,
      );
    });
    this.querier.put(key, next);
  }

  /** Who changed what last, for the admin list; settings without a row are at their default. */
  async rows(): Promise<
    Map<string, { updatedAt: Date; updatedBy: string | null }>
  > {
    const stored = await this.settings
      .find({}, { updatedAt: 1, updatedBy: 1 })
      .lean();
    return new Map(
      stored
        .filter((row) => definitionOf(row._id))
        .map((row) => [
          row._id,
          { updatedAt: row.updatedAt, updatedBy: row.updatedBy },
        ]),
    );
  }

  revisionsOf(key: SettingKey, page: number, pageSize: number) {
    return this.revisions.list(key, page, pageSize);
  }

  private readOrDefault(key: SettingKey, stored: unknown): unknown {
    try {
      return readSetting(key, SETTINGS[key], stored, this.key);
    } catch {
      return SETTINGS[key].default;
    }
  }
}
