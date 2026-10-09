import type { Permission } from '@libs/auth';

/** What the acting user of a sync client must hold: a client creates private contests, so it may do no more than this user could. Checked when a client is created and again on every request. */
export const ACTS_AS_PERMISSIONS: readonly Permission[] = [
  'judge.add_contest',
  'judge.create_private_contest',
];
