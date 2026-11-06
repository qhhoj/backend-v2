import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { MigrationRecord } from '@libs/database';
import { MIGRATIONS } from './migration';
import type { Migration } from './migration';

@Injectable()
export class MigrationRunner {
  private readonly logger = new Logger(MigrationRunner.name);

  constructor(
    @Inject(MIGRATIONS) private readonly migrations: readonly Migration[],
    @InjectModel(MigrationRecord.name)
    private readonly records: Model<MigrationRecord>,
  ) {}

  /** Runs, in order, each migration that has no record; the first failure stops the rest and is thrown. Returns the ids it ran. */
  async runPending(): Promise<string[]> {
    const recorded = new Set(
      (await this.records.find({}, { _id: 1 }).lean().exec()).map(
        (record) => record._id,
      ),
    );
    const ran: string[] = [];
    for (const migration of this.migrations) {
      if (recorded.has(migration.id)) continue;
      const changed = await migration.run().catch((error: unknown) => {
        throw new Error(migrationFailure(migration.id, error));
      });
      await this.records
        .updateOne(
          { _id: migration.id },
          { $setOnInsert: { at: new Date() } },
          { upsert: true },
        )
        .exec();
      this.logger.log(`${migration.id}: ${changed} documents changed`);
      ran.push(migration.id);
    }
    return ran;
  }
}

/** What the deploy log may show of a failed migration: a Mongo server error only by its code (its message can quote a document), anything else by its message. */
export function migrationFailure(id: string, error: unknown): string {
  const { code, codeName, message } = error as {
    code?: unknown;
    codeName?: unknown;
    message?: unknown;
  };
  const reason =
    typeof code === 'number'
      ? `${typeof codeName === 'string' ? codeName : 'Mongo error'} (code ${code})`
      : String(message);
  return `${id} failed: ${reason}`;
}
