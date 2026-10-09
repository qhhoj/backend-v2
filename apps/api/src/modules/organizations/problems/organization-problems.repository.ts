import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrganizationProblem, uuidStr } from '@libs/database';
import type { AnyBulkWriteOperation, Model } from 'mongoose';

@Injectable()
export class OrganizationProblemsRepository {
  constructor(
    @InjectModel(OrganizationProblem.name)
    private readonly links: Model<OrganizationProblem>,
  ) {}

  async findForProblems(
    organizationId: string,
    problemIds: readonly string[],
  ): Promise<Map<string, OrganizationProblem>> {
    const rows = await this.links
      .find({ organization: organizationId, problem: { $in: problemIds } })
      .exec();
    return new Map(rows.map((row) => [uuidStr(row.problem), row]));
  }

  async archivedProblemIds(organizationId: string): Promise<string[]> {
    const rows = await this.links
      .find({ organization: organizationId, archived: true }, { problem: 1 })
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row.problem));
  }

  /** Organizations in which the problem is archived. */
  async archivedOrganizationIds(problemId: string): Promise<string[]> {
    const rows = await this.links
      .find({ problem: problemId, archived: true }, { organization: 1 })
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row.organization));
  }

  async problemIdsWithTag(
    organizationId: string,
    tagId: string,
  ): Promise<string[]> {
    const rows = await this.links
      .find({ organization: organizationId, tagIds: tagId }, { problem: 1 })
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row.problem));
  }

  setTags(
    organizationId: string,
    problemId: string,
    tagIds: string[],
  ): Promise<OrganizationProblem> {
    return this.links
      .findOneAndUpdate(
        { organization: organizationId, problem: problemId },
        { $set: { tagIds }, $setOnInsert: { archived: false } },
        { upsert: true, new: true },
      )
      .exec();
  }

  async setArchived(
    organizationId: string,
    problemId: string,
    archived: boolean,
  ): Promise<void> {
    await this.links
      .updateOne(
        { organization: organizationId, problem: problemId },
        { $set: { archived }, $setOnInsert: { tagIds: [] } },
        { upsert: true },
      )
      .exec();
  }

  async bulkWrite(
    operations: AnyBulkWriteOperation<OrganizationProblem>[],
  ): Promise<void> {
    if (operations.length) await this.links.bulkWrite(operations);
  }
}
