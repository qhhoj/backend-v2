import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isUuid, OrganizationRequest, uuidStr } from '@libs/database';
import type { OrganizationRequestState } from '@libs/database';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

export type OrganizationRequestDocument = HydratedDocument<OrganizationRequest>;

export const ORGANIZATION_REQUEST_PAGE_SIZE = 50;

/** Requests filed by these users or sent to these organizations. */
export interface RequestQueueMatch {
  userIds: readonly string[];
  organizationIds: readonly string[];
}

@Injectable()
export class OrganizationRequestsRepository {
  constructor(
    @InjectModel(OrganizationRequest.name)
    private readonly requests: Model<OrganizationRequest>,
  ) {}

  create(
    organizationId: string,
    userId: string,
    reason: string,
  ): Promise<OrganizationRequestDocument> {
    return this.requests.create({
      organization: organizationId,
      user: userId,
      reason,
    });
  }

  findById(id: string): Promise<OrganizationRequestDocument | null> {
    return isUuid(id)
      ? this.requests.findById(id).exec()
      : Promise.resolve(null);
  }

  /** Through the partial unique index (the filter names `state: 'P'`). */
  async pendingIdOf(
    organizationId: string,
    userId: string,
  ): Promise<string | null> {
    const row = await this.requests
      .findOne(
        { organization: organizationId, user: userId, state: 'P' },
        { _id: 1 },
      )
      .lean()
      .exec();
    return row && uuidStr(row._id);
  }

  /** Legacy pending, approved and rejected tabs, newest first, through `{organization, state, _id}`. */
  list(
    organizationId: string,
    state: OrganizationRequestState,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrganizationRequest[]; total: number }> {
    return this.page({ organization: organizationId, state }, page, pageSize);
  }

  /** The staff queue across organizations, newest first, through `{state, _id}`; `among` keeps the requests of those users or organizations. */
  listAll(
    state: OrganizationRequestState,
    page: number,
    pageSize: number,
    among?: RequestQueueMatch,
  ): Promise<{ items: OrganizationRequest[]; total: number }> {
    const filter: FilterQuery<OrganizationRequest> = among
      ? {
          state,
          $or: [
            { user: { $in: among.userIds } },
            { organization: { $in: among.organizationIds } },
          ],
        }
      : { state };
    return this.page(filter, page, pageSize);
  }

  /** Everyone with a request in `state`: bounded by the requests, never the whole user base. */
  async requesterIds(state: OrganizationRequestState): Promise<string[]> {
    const ids = await this.requests.distinct('user', { state }).exec();
    return ids.map((id) => uuidStr(id));
  }

  private async page(
    filter: FilterQuery<OrganizationRequest>,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrganizationRequest[]; total: number }> {
    const [items, total] = await Promise.all([
      this.requests
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<OrganizationRequest[]>()
        .exec(),
      this.requests.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Compare-and-set from pending: false when it was decided meanwhile. */
  async decide(
    id: string,
    state: 'A' | 'R',
    decidedBy: string,
    decidedAt: Date,
  ): Promise<boolean> {
    const { matchedCount } = await this.requests
      .updateOne(
        { _id: id, state: 'P' },
        { $set: { state, decidedBy, decidedAt } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Undo a compare-and-set approval whose member could not be added. */
  async reopen(id: string): Promise<void> {
    await this.requests
      .updateOne(
        { _id: id, state: 'A' },
        { $set: { state: 'P' }, $unset: { decidedBy: 1, decidedAt: 1 } },
      )
      .exec();
  }
}
