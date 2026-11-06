import type { Collection, Document, Filter } from 'mongodb';

/**
 * Writes `defaults[field]` into each document of `collection` (among `filter`) that has no `field`; a stored value,
 * null included, is kept. One update per document, evaluated against the document as stored at that moment, so a
 * concurrent write of the field wins. Through the driver: no timestamps, no casting. Returns the documents changed.
 */
export async function fillMissing(
  collection: Collection,
  defaults: Record<string, unknown>,
  filter: Filter<Document> = {},
): Promise<number> {
  const fields = Object.keys(defaults);
  const { modifiedCount } = await collection.updateMany(
    {
      ...filter,
      $or: fields.map((field) => ({ [field]: { $exists: false } })),
    },
    [
      {
        $set: Object.fromEntries(
          fields.map((field) => [
            field,
            {
              $cond: [
                { $eq: [{ $type: `$${field}` }, 'missing'] },
                { $literal: defaults[field] },
                `$${field}`,
              ],
            },
          ]),
        ),
      },
    ],
  );
  return modifiedCount;
}
