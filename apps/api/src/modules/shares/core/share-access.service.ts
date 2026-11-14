import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { Share } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import { ShareGuardService } from '../guard/share-guard.service';
import { isExpired } from './share-expiry';
import { copyRefusalError, shareNotFound } from './share-hidden-reason';
import type { ShareHiddenReason } from './share-hidden-reason';
import { SharesRepository } from './shares.repository';

export const MANAGE_SHARE = 'judge.manage_share';

export const canManageShares = (principal: Principal | null): boolean =>
  principal !== null && hasPermission(principal, MANAGE_SHARE);

/** A banned, deactivated or deleted author's links are down for as long as that lasts. */
const isAuthorAvailable = (author: UserDocument | null): boolean =>
  author !== null && author.banReason === null && author.isActive;

/** A share as one viewer may read it. */
export interface ReadableShare {
  share: Share;
  author: UserDocument | null;
  /** The copied submission's problem (deleted ones too); null for a paste. */
  problem: ProblemDocument | null;
  isOwner: boolean;
  canManage: boolean;
  /** Why others cannot read it now; only the owner or staff ever get a non-null one. */
  hiddenReason: ShareHiddenReason | null;
}

/** The one read rule of `/c/<code>`, for the page, its raw and download forms and reports alike. */
@Injectable()
export class ShareAccessService {
  constructor(
    private readonly shares: SharesRepository,
    private readonly users: UsersRepository,
    private readonly problems: ProblemsRepository,
    private readonly guard: ShareGuardService,
  ) {}

  /** The unexpired share under the code, for its owner's and staff's own actions; 404 otherwise. */
  async live(code: string, now: Date): Promise<Share> {
    const share = await this.shares.findByCode(code.toLowerCase());
    if (!share || isExpired(share, now)) throw shareNotFound();
    return share;
  }

  /** 404 for an unknown or expired code; a hidden share is 404 when taken down or its author is gone, 403 (`contest_running`, `hidden`) under the copy rules, which are checked again on every read; staff pass all of these, the owner the copy rules. */
  async readable(
    principal: Principal | null,
    code: string,
    { withSource, now }: { withSource: boolean; now: Date },
  ): Promise<ReadableShare> {
    const share = await this.shares.findByCode(code.toLowerCase(), {
      withSource,
    });
    if (!share || isExpired(share, now)) throw shareNotFound();
    const [author, problem] = await Promise.all([
      this.users.findById(uuidStr(share.createdBy)),
      share.copy
        ? this.problems.findIncludingDeleted(uuidStr(share.copy.problem))
        : null,
    ]);
    const isOwner = uuidStr(share.createdBy) === principal?.userId;
    const canManage = canManageShares(principal);
    const hiddenReason = await this.hiddenReasonOf(
      share,
      { author, problem },
      now,
    );
    if (hiddenReason !== null && !canManage)
      assertOwnerMaySee(hiddenReason, isOwner);
    return { share, author, problem, isOwner, canManage, hiddenReason };
  }

  private async hiddenReasonOf(
    share: Share,
    {
      author,
      problem,
    }: { author: UserDocument | null; problem: ProblemDocument | null },
    now: Date,
  ): Promise<ShareHiddenReason | null> {
    if (share.takenDown) return 'taken_down';
    if (!isAuthorAvailable(author)) return 'author_unavailable';
    if (!share.copy) return null;
    return this.guard.refusalOf(
      {
        problemId: uuidStr(share.copy.problem),
        problem: problem?.deletedAt ? null : problem,
        contestId: share.copy.contest ? uuidStr(share.copy.contest) : null,
      },
      now,
    );
  }
}

/** A takedown or a removed author hides the share from its owner too; the copy rules do not. */
function assertOwnerMaySee(reason: ShareHiddenReason, isOwner: boolean): void {
  if (reason === 'taken_down' || reason === 'author_unavailable')
    throw shareNotFound();
  if (!isOwner) throw copyRefusalError(reason);
}
