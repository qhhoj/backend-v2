import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';

/** Legacy `has_perm('judge.change_comment')`: reads hidden comments, edits any comment and replies past the reply window. */
export const moderatesComments = (principal: Principal | null): boolean =>
  principal !== null && hasPermission(principal, 'judge.change_comment');
