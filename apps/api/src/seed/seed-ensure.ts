import { CI } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';

/** The existing row, or a new one made from `fields`; an existing row is never touched. */
export async function ensure<Row extends { _id: string }>(
  model: Model<Row>,
  filter: FilterQuery<Row>,
  fields: Partial<Row>,
  { isCaseInsensitive = false }: { isCaseInsensitive?: boolean } = {},
): Promise<Row> {
  const query = model.findOne(filter);
  const existing = await (
    isCaseInsensitive ? query.collation(CI) : query
  ).exec();
  return existing ?? (await model.create(fields));
}
