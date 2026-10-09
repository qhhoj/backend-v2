import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrganizationProblem,
  OrganizationProblemTag,
  uuidStr,
} from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class ProblemTagsRepository {
  constructor(
    @InjectModel(OrganizationProblemTag.name)
    private readonly tags: Model<OrganizationProblemTag>,
    @InjectModel(OrganizationProblem.name)
    private readonly links: Model<OrganizationProblem>,
  ) {}

  async list(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrganizationProblemTag[]; total: number }> {
    const filter = { organization: organizationId };
    const [items, total] = await Promise.all([
      this.tags
        .find(filter)
        .sort({ slug: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.tags.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  findBySlug(organizationId: string, slug: string) {
    return this.tags.findOne({ organization: organizationId, slug }).exec();
  }

  findByIds(organizationId: string, ids: readonly string[]) {
    return this.tags
      .find({ organization: organizationId, _id: { $in: ids } })
      .exec();
  }

  /** Every tag of the organization by id string, for rendering link rows. */
  async mapForOrganization(
    organizationId: string,
  ): Promise<Map<string, OrganizationProblemTag>> {
    const rows = await this.tags.find({ organization: organizationId }).exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row]));
  }

  count(organizationId: string): Promise<number> {
    return this.tags.countDocuments({ organization: organizationId }).exec();
  }

  create(fields: Partial<OrganizationProblemTag>) {
    return this.tags.create(fields);
  }

  async update(
    id: string,
    changes: Partial<OrganizationProblemTag>,
  ): Promise<void> {
    await this.tags.updateOne({ _id: id }, { $set: changes }).exec();
  }

  /** Links first, then the tag: a crash in between leaves an unused tag, never a link to a missing one. */
  async remove(organizationId: string, id: string): Promise<void> {
    await this.links
      .updateMany(
        { organization: organizationId, tagIds: id },
        { $pull: { tagIds: id } },
      )
      .exec();
    await this.tags.deleteOne({ _id: id }).exec();
  }
}
