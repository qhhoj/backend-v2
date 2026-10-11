import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { escapeRegExp } from '@libs/common';
import { CI, Organization, uuidStr } from '@libs/database';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

/** Case-insensitive literal substring over name, short name and slug: the one organization text search. */
export const organizationSearchFilter = (
  search: string,
): FilterQuery<Organization> => {
  const pattern = new RegExp(escapeRegExp(search), 'i');
  return {
    $or: ['name', 'shortName', 'slug'].map((field) => ({ [field]: pattern })),
  };
};

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
  ) {}

  /** Case-insensitive, like the unique index; a malformed slug simply matches nothing. */
  findBySlug(slug: string): Promise<OrganizationDocument | null> {
    return this.organizations.findOne({ slug }).collation(CI).exec();
  }

  findByIds(ids: readonly string[]): Promise<Organization[]> {
    return ids.length
      ? this.organizations
          .find({ _id: { $in: ids } })
          .lean<Organization[]>()
          .exec()
      : Promise.resolve([]);
  }

  async list(
    filter: FilterQuery<Organization>,
    page: number,
    pageSize: number,
  ): Promise<{ items: Organization[]; total: number }> {
    const [items, total] = await Promise.all([
      this.organizations
        .find(filter, { about: 0 })
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Organization[]>()
        .exec(),
      this.organizations.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Ids of the organizations `organizationSearchFilter` matches; a staff search over a small collection. */
  async idsMatching(search: string): Promise<string[]> {
    const rows = await this.organizations
      .find(organizationSearchFilter(search), { _id: 1 })
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }

  async exists(filter: FilterQuery<Organization>): Promise<boolean> {
    return (await this.organizations.exists(filter).exec()) !== null;
  }

  /** Ids of the organizations a user is an admin of; through `{adminIds}`. */
  async idsAdministeredBy(userId: string): Promise<string[]> {
    const rows = await this.organizations
      .find({ adminIds: userId }, { _id: 1 })
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }

  /** Through `{adminIds}`. */
  countAdminRoles(userId: string): Promise<number> {
    return this.organizations.countDocuments({ adminIds: userId }).exec();
  }

  create(fields: Partial<Organization>): Promise<OrganizationDocument> {
    return this.organizations.create(fields);
  }

  async update(id: string, changes: Partial<Organization>): Promise<void> {
    await this.organizations.updateOne({ _id: id }, { $set: changes }).exec();
  }
}
