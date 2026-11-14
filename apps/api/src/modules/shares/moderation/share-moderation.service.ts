import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { ShareAccessService } from '../core/share-access.service';
import { shareRevision } from '../core/share-revision';
import { SharesRepository } from '../core/shares.repository';

/** Staff takedown (soft, reversible) and restore; each is a `share` revision in the audit log. */
@Injectable()
export class ShareModerationService {
  constructor(
    private readonly shares: SharesRepository,
    private readonly access: ShareAccessService,
    private readonly revisions: RevisionsRepository,
  ) {}

  /** 409 `conflict` when it is already down. */
  async takedown(
    principal: Principal,
    code: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const share = await this.access.live(code, now);
    const takedown = { at: now, by: principal.userId, reason: reason.trim() };
    if (!(await this.shares.setTakedown(uuidStr(share._id), takedown)))
      throw new AppError('conflict', 409, 'This share is already taken down');
    await this.revisions.append(
      shareRevision(share, {
        action: 'takedown',
        actorId: principal.userId,
        reason: takedown.reason,
      }),
    );
  }

  /** 409 `conflict` when it is not down. */
  async restore(principal: Principal, code: string): Promise<void> {
    const share = await this.access.live(code, new Date());
    if (!(await this.shares.setTakedown(uuidStr(share._id), null)))
      throw new AppError('conflict', 409, 'This share is not taken down');
    await this.revisions.append(
      shareRevision(share, {
        action: 'restore',
        actorId: principal.userId,
        reason: share.takenDown?.reason ?? '',
      }),
    );
  }
}
