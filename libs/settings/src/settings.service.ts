import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Setting, SettingRevision } from '@libs/database';
import type { ClientSession, Connection, Model } from 'mongoose';
import { definitionOf, secretsUnboundBy, SETTINGS } from './registry';
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
   * A URL that moves to another origin resets its `originBoundSecrets` in the same transaction.
   * Throws `SettingError` for an invalid result; nothing is written then.
   */
  async set(
    key: SettingKey,
    patch: unknown,
    actorId: string | null,
  ): Promise<void> {
    const definition = SETTINGS[key];
    let written: [SettingKey, unknown][] = [];
    await this.connection.transaction(async (session) => {
      const before = await this.stored(key, session);
      const next = definition.type.parse(
        definition.combine ? definition.combine(before as never, patch) : patch,
      );
      await this.write(key, { before, next }, actorId, session);
      written = [
        [key, next],
        ...(await this.resetSecrets(
          secretsUnboundBy(key, before, next),
          actorId,
          session,
        )),
      ];
    });
    for (const [writtenKey, value] of written)
      this.querier.put(writtenKey, value);
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

  /** The revision of this setting only: another setting's revision reads as missing. */
  async revisionOf(
    key: SettingKey,
    revisionId: string,
  ): Promise<SettingRevision | null> {
    const revision = await this.revisions.findById(revisionId);
    return revision?.key === key ? revision : null;
  }

  /** The stored value, or the default when there is no row. */
  private async stored(key: SettingKey, session: ClientSession) {
    const row = await this.settings.findById(key).session(session).lean();
    return row ? this.readOrDefault(key, row.value) : SETTINGS[key].default;
  }

  /** Upserts `next` sealed and writes the redacted revision from `before`. */
  private async write(
    key: SettingKey,
    { before, next }: { before: unknown; next: unknown },
    actorId: string | null,
    session: ClientSession,
  ): Promise<void> {
    const definition = SETTINGS[key];
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
  }

  /** Each of `keys` back to its default, with a revision; one already there is left alone. Returns what was written. */
  private async resetSecrets(
    keys: SettingKey[],
    actorId: string | null,
    session: ClientSession,
  ): Promise<[SettingKey, unknown][]> {
    const reset: [SettingKey, unknown][] = [];
    for (const key of keys) {
      const before = await this.stored(key, session);
      const empty = SETTINGS[key].default;
      if (!changedFields(before, empty).length) continue;
      await this.write(key, { before, next: empty }, actorId, session);
      reset.push([key, empty]);
    }
    return reset;
  }

  private readOrDefault(key: SettingKey, stored: unknown): unknown {
    try {
      return readSetting(key, SETTINGS[key], stored, this.key);
    } catch {
      return SETTINGS[key].default;
    }
  }
}
