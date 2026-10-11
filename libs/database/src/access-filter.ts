import type { FilterQuery } from 'mongoose';

/** No row matches. */
const NOTHING = { _id: { $in: [] } };

/**
 * Turns an access filter (`null`: admits nothing, `{}`: admits everything) into a list narrowing:
 * `true` keeps the rows the filter admits, `false` keeps the rest.
 */
export function narrowTo<T>(
  filter: FilterQuery<T> | null,
  wanted: boolean,
): FilterQuery<T> {
  if (filter === null) return wanted ? NOTHING : {};
  return wanted ? filter : { $nor: [filter] };
}
