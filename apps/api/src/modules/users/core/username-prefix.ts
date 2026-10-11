import type { FilterQuery } from 'mongoose';
import type { User } from '@libs/database';

/** Sorts after every username that starts with the prefix, so the range `[prefix, prefix + PREFIX_END)` covers it. */
const PREFIX_END = '￿';

/** Usernames starting with `prefix`: a range over the username index, never a regex. Run it with the `CI` collation so it ignores case. */
export const usernamePrefixFilter = (prefix: string): FilterQuery<User> => ({
  username: { $gte: prefix, $lt: `${prefix}${PREFIX_END}` },
});
