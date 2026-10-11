import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isDuplicateKey } from '@libs/common';
import { MiscConfig } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class MiscConfigRepository {
  constructor(
    @InjectModel(MiscConfig.name) private readonly config: Model<MiscConfig>,
  ) {}

  /** Creates or replaces by key; two first writes of one key race to the unique index, so the loser retries as an update. */
  async upsert(key: string, value: string): Promise<void> {
    const write = () =>
      this.config
        .updateOne({ key }, { $set: { value } }, { upsert: true })
        .exec();
    try {
      await write();
    } catch (error) {
      if (!isDuplicateKey(error, 'key')) throw error;
      await write();
    }
  }

  /** The stored value; null when the key is absent. */
  async valueOf(key: string): Promise<string | null> {
    const row = await this.config
      .findOne({ key }, { value: 1 })
      .lean<Pick<MiscConfig, 'value'>>()
      .exec();
    return row ? row.value : null;
  }

  /** False when the key was absent. */
  async delete(key: string): Promise<boolean> {
    return (await this.config.deleteOne({ key }).exec()).deletedCount > 0;
  }
}
