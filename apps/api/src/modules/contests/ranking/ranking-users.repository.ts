import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Organization, User, uuidStr } from '@libs/database';

export interface RankingUser {
  username: string;
  rating: number | null;
  organization: string | null;
}

@Injectable()
export class RankingUsersRepository {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
  ) {}

  /**
   * Username, rating and first organization's short name for boards of thousands of rows (two lean reads).
   * Boards are cached for every viewer, so a school shows only when the organization is listed (`OrganizationAccess.canList` for anyone).
   */
  async rankingUsersOf(userIds: string[]): Promise<Map<string, RankingUser>> {
    const rows = await this.users
      .find(
        { _id: { $in: userIds } },
        { username: 1, rating: 1, organizations: { $slice: 1 } },
      )
      .lean();
    const firstIds = [
      ...new Set(rows.flatMap((row) => row.organizations.map(uuidStr))),
    ];
    const shortNames = new Map(
      (
        await this.organizations
          .find({ _id: { $in: firstIds }, isUnlisted: false }, { shortName: 1 })
          .lean()
      ).map((organization) => [
        uuidStr(organization._id),
        organization.shortName,
      ]),
    );
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        {
          username: row.username,
          rating: row.rating,
          organization:
            shortNames.get(uuidStr(row.organizations[0] ?? '')) ?? null,
        },
      ]),
    );
  }
}
