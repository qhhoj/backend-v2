import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { BaseMongoStreamQuerier } from '@libs/common';
import { Setting } from '@libs/database';
import type { Model } from 'mongoose';
import { definitionOf, SETTINGS } from './registry';
import type { SettingKey, SettingValue } from './registry';
import { readSetting } from './sealing';
import { SETTINGS_KEY } from './settings-key';

/** In-memory typed snapshot of the `settings` collection, fresh by change stream plus a one-minute resync; an unreadable row reads as its default. */
@Injectable()
export class SettingsQuerier
  extends BaseMongoStreamQuerier
  implements OnModuleInit
{
  private readonly logger = new Logger(SettingsQuerier.name);
  private values = new Map<SettingKey, unknown>();

  constructor(
    @InjectModel(Setting.name) private readonly model: Model<Setting>,
    @Inject(SETTINGS_KEY) private readonly key: Buffer,
    scheduler: SchedulerRegistry,
  ) {
    super(scheduler);
  }

  async onModuleInit() {
    await this.setupMongoStream(
      this.model,
      [],
      // eslint-disable-next-line @typescript-eslint/require-await
      async ({ fullDocument }) =>
        void (fullDocument && this.load(this.values, fullDocument as Setting)),
      () => this.resync(),
    );
    this.forceResyncQuerier(() => this.resync(), CronExpression.EVERY_MINUTE);
  }

  async resync() {
    const next = new Map<SettingKey, unknown>();
    for (const row of await this.loadAll(this.model)) this.load(next, row);
    this.values = next;
  }

  get<Key extends SettingKey>(key: Key): SettingValue<Key> {
    return (
      this.values.has(key) ? this.values.get(key) : SETTINGS[key].default
    ) as SettingValue<Key>;
  }

  /** The writer's own process sees its change before the stream delivers it. */
  put(key: SettingKey, value: unknown): void {
    this.values.set(key, value);
  }

  /** The error is dropped on purpose: a JSON parse error can quote decrypted text. */
  private load(target: Map<SettingKey, unknown>, row: Setting): void {
    const definition = definitionOf(row._id);
    if (!definition) return;
    try {
      target.set(
        row._id as SettingKey,
        readSetting(row._id, definition, row.value, this.key),
      );
    } catch {
      target.delete(row._id as SettingKey);
      this.logger.warn(`Setting ${row._id} is unreadable; using its default`);
    }
  }
}
