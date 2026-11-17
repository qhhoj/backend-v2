import { isKnownPermission } from './permission-catalog';

/** Rights that reach only the holder's own objects (decision 659's organization admin role): they give no power over other accounts or the site. */
const OWN_SCOPE_PERMISSIONS: ReadonlySet<string> = new Set([
  'judge.edit_own_contest',
  'judge.edit_own_problem',
  'judge.create_organization_problem',
  'judge.create_private_contest',
]);

/** The rights that make an account staff for account actions: catalog permissions (out-of-catalog legacy codenames grant nothing) beyond the own-scope ones. */
export const shieldingRights = (rights: ReadonlySet<string>): string[] =>
  [...rights].filter(
    (right) => isKnownPermission(right) && !OWN_SCOPE_PERMISSIONS.has(right),
  );
