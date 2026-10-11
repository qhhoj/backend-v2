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

/** Every read goes through this: a soft-deleted organization exists for nobody. */
const LIVE = { deletedAt: null };

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
  ) {}

  /** Organization delete only: a deleted organization keeps its slug, so the delete can be repeated to finish an interrupted unlink. */
  findBySlugIncludingDeleted(
    slug: string,
  ): Promise<OrganizationDocument | null> {
    return this.organizations.findOne({ slug }).collation(CI).exec();
  }

  /** Case-insensitive, like the unique index; a malformed slug simply matches nothing. */
  findBySlug(slug: string): Promise<OrganizationDocument | null> {
    return this.organizations
      .findOne({ slug, ...LIVE })
      .collation(CI)
      .exec();
  }

  /** `includeDeleted`: for records that outlive the organization, such as decided join requests. */
  findByIds(
    ids: readonly string[],
    { includeDeleted = false } = {},
  ): Promise<Organization[]> {
    return ids.length
      ? this.organizations
          .find({ _id: { $in: ids }, ...(includeDeleted ? {} : LIVE) })
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
        .find({ $and: [filter, LIVE] }, { about: 0 })
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Organization[]>()
        .exec(),
      this.organizations.countDocuments({ $and: [filter, LIVE] }).exec(),
    ]);
    return { items, total };
  }

  /** Ids of the organizations `organizationSearchFilter` matches; a staff search over a small collection. */
  async idsMatching(search: string): Promise<string[]> {
    const rows = await this.organizations
      .find({ ...organizationSearchFilter(search), ...LIVE }, { _id: 1 })
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }

  async exists(filter: FilterQuery<Organization>): Promise<boolean> {
    return (
      (await this.organizations.exists({ $and: [filter, LIVE] }).exec()) !==
      null
    );
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
    return this.organizations
      .countDocuments({ adminIds: userId, ...LIVE })
      .exec();
  }

  create(fields: Partial<Organization>): Promise<OrganizationDocument> {
    return this.organizations.create(fields);
  }

  async update(id: string, changes: Partial<Organization>): Promise<void> {
    await this.organizations
      .updateOne({ _id: id, ...LIVE }, { $set: changes })
      .exec();
  }

  /** False when it was already deleted. */
  async markDeleted(id: string, deletedBy: string): Promise<boolean> {
    const { modifiedCount } = await this.organizations
      .updateOne(
        { _id: id, ...LIVE },
        { $set: { deletedAt: new Date(), deletedBy } },
      )
      .exec();
    return modifiedCount === 1;
  }
}
