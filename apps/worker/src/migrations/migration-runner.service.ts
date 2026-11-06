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
    const ran: string[] = [];
    for (const migration of await this.pending()) {
      const changed = await migration.run().catch((error: unknown) => {
        this.logger.debug(error);
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

  /** Throws while any migration has no record: the worker boots only on data `worker migrate` has brought up to date. */
  async assertNonePending(): Promise<void> {
    const ids = (await this.pending()).map((migration) => migration.id);
    if (ids.length > 0)
      throw new Error(
        `migrations pending: ${ids.join(', ')}; run \`worker migrate\` first`,
      );
  }

  private async pending(): Promise<Migration[]> {
    const recorded = new Set(
      (await this.records.find({}, { _id: 1 }).lean().exec()).map(
        (record) => record._id,
      ),
    );
    return this.migrations.filter((migration) => !recorded.has(migration.id));
  }
}

/**
 * What the deploy log (public) may show of a failed migration: a Mongo server error by its code (its message can quote a
 * document), a system error by its code (its message names a path), anything else by its name. The whole error is
 * logged at debug level (RUNBOOK: run the step by hand with `LOG_LEVEL=debug`).
 */
export function migrationFailure(id: string, error: unknown): string {
  const { code, codeName, name } = (error ?? {}) as {
    code?: unknown;
    codeName?: unknown;
    name?: unknown;
  };
  if (typeof code === 'number')
    return `${id} failed: ${typeof codeName === 'string' ? codeName : 'Mongo error'} (code ${code})`;
  if (typeof code === 'string') return `${id} failed: ${code} (system error)`;
  return `${id} failed: ${typeof name === 'string' ? name : 'unknown error'}`;
}
