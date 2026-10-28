import type { Revision } from '@libs/database';
import type { JudgeResponse } from './dto/judge.response';
import type { JudgeChanges } from './judges.repository';

/** The `action` of a `judge` revision. A key rotation records no field: the key and its hash never enter a revision. */
export type JudgeAction =
  | 'create'
  | 'edit'
  | 'block'
  | 'unblock'
  | 'disable'
  | 'enable'
  | 'rename'
  | 'delete'
  | 'rotate_key'
  | 'disconnect'
  | 'force_disconnect';

export type JudgeFieldChanges = Revision['changes'];

/** Only the fields whose value differs from `before`; `authKeyHash` is never listed. */
export function judgeFieldChanges(
  before: JudgeResponse,
  changes: JudgeChanges,
): JudgeFieldChanges {
  const fields: JudgeChanges = { ...changes };
  delete fields.authKeyHash;
  return Object.fromEntries(
    Object.entries(fields)
      .filter(
        ([field, after]) => before[field as keyof JudgeResponse] !== after,
      )
      .map(([field, after]) => [
        field,
        { before: before[field as keyof JudgeResponse], after },
      ]),
  );
}

/** A patch is named by its strongest change: a block or unblock, then a disable or enable, else an edit. */
export function judgeEditAction(changed: JudgeFieldChanges): JudgeAction {
  if (changed.isBlocked) return changed.isBlocked.after ? 'block' : 'unblock';
  if (changed.isDisabled)
    return changed.isDisabled.after ? 'disable' : 'enable';
  return 'edit';
}
