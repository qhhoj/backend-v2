import { Document } from 'mongodb';
import { Connection, Model } from 'mongoose';

/** collection name → its model (null: none), per connection; verify asks once per document. */
const modelCache = new WeakMap<
  Connection,
  Map<string, Model<unknown> | null>
>();

function modelOf(conn: Connection, collection: string): Model<unknown> | null {
  const byCollection =
    modelCache.get(conn) ?? modelCache.set(conn, new Map()).get(conn)!;
  if (!byCollection.has(collection))
    byCollection.set(
      collection,
      Object.values(conn.models).find(
        (candidate) => candidate.collection.collectionName === collection,
      ) ?? null,
    );
  return byCollection.get(collection)!;
}

/** The v2 model's validation errors for a mapped document, plus top-level keys it does not declare (`new model(doc)` drops those silently, and verify rebuilds with the same mapper): a migrated row the API could not save again is a migration bug, not a later 400. */
export function schemaErrors(
  conn: Connection,
  collection: string,
  doc: Document,
): string[] {
  const model = modelOf(conn, collection);
  if (!model) return [];
  const error = new model(doc).validateSync();
  const invalid = error
    ? Object.entries(error.errors).map(
        ([path, cause]) => `${path}: ${cause.kind}`,
      )
    : [];
  const stray = Object.keys(doc)
    .filter(
      (key) =>
        !model.schema.path(key) && model.schema.pathType(key) !== 'nested',
    )
    .map((key) => `${key}: not in schema`);
  return [...invalid, ...stray];
}
