import { Document, UUID } from 'mongodb';
import { LegacySourceService } from './legacy-source.service';

export interface MapCtx {
  ref(table: string, id: number | null): UUID | null;
  refs(table: string, ids: number[]): UUID[];
  date(value: unknown): Date | null;
  bool(value: unknown): boolean;
  json(value: unknown): unknown;
}

/** A document keyed by a uuid _id. */
export type MappedDocument = Document & { _id: UUID };

/** A backfill job: addressed by `name`, writes `collection`. */
export interface Mapper<Row = any> {
  name: string;
  collection: string;
  /** Legacy tables whose ids this mapper resolves (including its own). */
  refTables: string[];
  /** Must be ordered by the legacy primary key. */
  sql: string;
  prepare?(source: LegacySourceService): Promise<void>;
  map(row: Row, ctx: MapCtx): MappedDocument;
  /** Replace non-deterministic fields (e.g. random-IV ciphertext) before verify compares. */
  normalize?(doc: MappedDocument): Document;
}

export const MAPPERS = Symbol('MAPPERS');

export async function* batched<T>(
  items: AsyncIterable<T>,
  size: number,
): AsyncGenerator<T[]> {
  const batch: T[] = [];
  for await (const item of items)
    if (batch.push(item) === size) yield batch.splice(0);
  if (batch.length) yield batch;
}

export function groupBy<T, V>(
  rows: T[],
  key: keyof T,
  value: (row: T) => V,
): Map<number, V[]> {
  const groups = new Map<number, V[]>();
  for (const row of rows) {
    const groupKey = row[key] as number;
    (groups.get(groupKey) ?? groups.set(groupKey, []).get(groupKey)!).push(
      value(row),
    );
  }
  return groups;
}
