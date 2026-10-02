import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { newId } from '@libs/database';
import { Connection } from 'mongoose';
import { LegacySource } from './legacy-source';
import { batched } from './mapper';

/** Tables whose rows reuse another table's uuid: sql yields {id, target}. */
const ALIASES: Record<string, { sql: string; target: string }> = {
  judge_profile: {
    sql: 'SELECT id, user_id AS target FROM judge_profile ORDER BY id',
    target: 'auth_user',
  },
};

type IdEntry = { table: string; legacyId: number; id: string };

@Injectable()
export class IdMap {
  private cache = new Map<string, Map<number, string>>();

  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly source: LegacySource,
  ) {}

  private get collection() {
    return this.conn.collection<IdEntry>('migrationIdMap');
  }

  /** Incremental and stable: only legacy ids without an entry get a new uuid. */
  async build() {
    this.cache.clear();
    await this.collection.createIndex(
      { table: 1, legacyId: 1 },
      { unique: true },
    );
    const tables = await this.source.query<{ tableName: string }>(
      "SELECT table_name AS tableName FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND column_key = 'PRI'",
    );
    for (const { tableName } of tables.filter(
      ({ tableName }) => !(tableName in ALIASES),
    ))
      await this.sync(
        tableName,
        this.source.stream<{ id: number }>(`SELECT id FROM \`${tableName}\``),
        () => newId(),
      );
    for (const [tableName, { sql, target }] of Object.entries(ALIASES)) {
      await this.load([target]);
      await this.sync(
        tableName,
        this.source.stream<{ id: number; target: number }>(sql),
        (row) => this.get(target, row.target),
      );
    }
  }

  async load(tables: string[]) {
    for (const table of tables.filter((name) => !this.cache.has(name)))
      this.cache.set(
        table,
        new Map(
          (await this.collection.find({ table }).toArray()).map((entry) => [
            entry.legacyId,
            entry.id,
          ]),
        ),
      );
  }

  get(table: string, legacyId: number): string {
    const id = this.cache.get(table)?.get(legacyId);
    if (!id) throw new Error(`no uuid for ${table}:${legacyId}`);
    return id;
  }

  private async sync<Row extends { id: number }>(
    table: string,
    rows: AsyncIterable<Row>,
    resolve: (row: Row) => string,
  ) {
    this.cache.delete(table);
    await this.load([table]);
    const known = this.cache.get(table)!;
    for await (const batch of batched(rows, 5000)) {
      const fresh = batch
        .filter((row) => !known.has(row.id))
        .map((row) => ({ table, legacyId: row.id, id: resolve(row) }));
      if (!fresh.length) continue;
      await this.collection.insertMany(fresh);
      for (const entry of fresh) known.set(entry.legacyId, entry.id);
    }
    this.cache.delete(table);
  }
}
