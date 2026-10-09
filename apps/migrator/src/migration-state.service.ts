import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MIGRATION_STATE_COLLECTION, MIGRATION_STATE_ID } from '@libs/judging';

/** The "this database is being migrated" marker the worker's recompute job requires. */
@Injectable()
export class MigrationStateService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private get marker() {
    return this.conn.collection<{ _id: string; since: Date }>(
      MIGRATION_STATE_COLLECTION,
    );
  }

  async begin(): Promise<void> {
    await this.marker.updateOne(
      { _id: MIGRATION_STATE_ID },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async finish(): Promise<void> {
    await this.marker.deleteOne({ _id: MIGRATION_STATE_ID });
  }

  async isActive(): Promise<boolean> {
    return (await this.marker.countDocuments({ _id: MIGRATION_STATE_ID })) > 0;
  }
}
