import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isUuid, OrganizationRequest, uuidStr } from '@libs/database';
import type { OrganizationRequestState } from '@libs/database';
import type { HydratedDocument, Model } from 'mongoose';

export type OrganizationRequestDocument = HydratedDocument<OrganizationRequest>;

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
  async list(
    organizationId: string,
    state: OrganizationRequestState,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrganizationRequest[]; total: number }> {
    const filter = { organization: organizationId, state };
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
}
