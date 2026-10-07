import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Organization, User } from '@libs/database';

@Injectable()
export class OrganizationPointsRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** The best `limit` member PPs above 0, through `{organizations, performancePoints}`. */
  async topMemberPoints(
    organizationId: string,
    limit: number,
  ): Promise<number[]> {
    const rows = await this.users
      .find(
        { organizations: organizationId, performancePoints: { $gt: 0 } },
        { _id: 0, performancePoints: 1 },
      )
      .sort({ performancePoints: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => row.performancePoints);
  }

  /** Every member, listed or not (legacy `members.count()`); a count scan of the same index. */
  countMembers(organizationId: string): Promise<number> {
    return this.users.countDocuments({ organizations: organizationId }).exec();
  }

  async setPoints(
    organizationId: string,
    fields: Pick<Organization, 'performancePoints' | 'memberCount'>,
  ): Promise<void> {
    await this.organizations
      .updateOne({ _id: organizationId }, { $set: fields })
      .exec();
  }
}
