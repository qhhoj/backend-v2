import { uuidStr } from '@libs/database';
import type { Revision, Share } from '@libs/database';

export const SHARE_REVISION_ACTIONS = [
  'takedown',
  'restore',
  'delete',
] as const;
export type ShareRevisionAction = (typeof SHARE_REVISION_ACTIONS)[number];

/** A staff action on a share, for the audit feed (`share` revisions); `comment` holds the reason. */
export const shareRevision = (
  share: Share,
  {
    action,
    actorId,
    reason,
  }: { action: ShareRevisionAction; actorId: string; reason: string },
): Pick<
  Revision,
  'entity' | 'entityId' | 'action' | 'userId' | 'changes' | 'comment'
> => ({
  entity: 'share',
  entityId: uuidStr(share._id),
  action,
  userId: actorId,
  changes: {
    takenDown: {
      before: share.takenDown !== null,
      after: action === 'takedown',
    },
  },
  comment: reason,
});
