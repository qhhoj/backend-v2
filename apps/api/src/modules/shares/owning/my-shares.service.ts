import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Share } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import {
  ShareListItemResponse,
  ShareSummaryResponse,
} from '../core/dto/share.response';
import {
  canManageShares,
  MANAGE_SHARE,
  ShareAccessService,
} from '../core/share-access.service';
import { expiresAtOf } from '../core/share-expiry';
import { shareRevision } from '../core/share-revision';
import { cleanTitle } from '../core/share-title';
import { activeFilter, SharesRepository } from '../core/shares.repository';
import type { EditShareDto, ShareListQueryDto } from './dto/my-shares.dto';

const notOwner = () =>
  new AppError('forbidden', 403, 'Only the owner can change this share');

/** A user's own shares: list, edit, delete; staff list and delete everyone's. */
@Injectable()
export class MySharesService {
  constructor(
    private readonly shares: SharesRepository,
    private readonly access: ShareAccessService,
    private readonly users: UsersRepository,
    private readonly revisions: RevisionsRepository,
  ) {}

  /** Unexpired shares, newest first; taken-down ones stay listed with their takedown. */
  async list(
    principal: Principal,
    { scope, submissionId, page, pageSize }: ShareListQueryDto,
  ): Promise<Paginated<ShareListItemResponse>> {
    if (scope === 'all' && !canManageShares(principal))
      throw new AppError(
        'forbidden',
        403,
        `Listing every share needs ${MANAGE_SHARE}`,
      );
    const filter: FilterQuery<Share> = {
      ...(scope === 'mine' ? { createdBy: principal.userId } : {}),
      ...(submissionId ? { 'copy.submissionId': submissionId } : {}),
      ...activeFilter(new Date()),
    };
    const { items, total } = await this.shares.list(filter, page, pageSize);
    const authors = await this.users.findByIds(
      unique(items.map((share) => uuidStr(share.createdBy))),
    );
    const authorOf = new Map(authors.map((author) => [author._id, author]));
    return new Paginated(
      items.map((share) =>
        ShareListItemResponse.withAuthor(
          share,
          authorOf.get(uuidStr(share.createdBy)),
        ),
      ),
      { page, pageSize, total },
    );
  }

  /** The owner's title and expiry (the new expiry counts from now). */
  async edit(
    principal: Principal,
    code: string,
    { title, expiry }: EditShareDto,
  ): Promise<ShareSummaryResponse> {
    const now = new Date();
    const share = await this.access.live(code, now);
    if (uuidStr(share.createdBy) !== principal.userId) throw notOwner();
    const fields = {
      ...(title !== undefined ? { title: cleanTitle(title) } : {}),
      ...(expiry !== undefined ? { expiresAt: expiresAtOf(expiry, now) } : {}),
    };
    if (!Object.keys(fields).length) return ShareSummaryResponse.from(share);
    const updated = await this.shares.update(uuidStr(share._id), fields);
    if (!updated) throw new AppError('not_found', 404, 'No such share');
    return ShareSummaryResponse.from(updated);
  }

  /** Hard delete by the owner, or by staff (audit-logged). */
  async remove(principal: Principal, code: string): Promise<void> {
    const share = await this.access.live(code, new Date());
    const isOwner = uuidStr(share.createdBy) === principal.userId;
    if (!isOwner && !canManageShares(principal)) throw notOwner();
    await this.shares.remove(uuidStr(share._id));
    if (!isOwner)
      await this.revisions.append(
        shareRevision(share, {
          action: 'delete',
          actorId: principal.userId,
          reason: '',
        }),
      );
  }
}
