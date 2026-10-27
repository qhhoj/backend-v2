import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  BlogPost,
  Contest,
  ContestParticipation,
  Flatpage,
  Group,
  Judge,
  License,
  Organization,
  Problem,
  ProblemGroup,
  ProblemType,
  Submission,
  User,
  uuidStr,
} from '@libs/database';

interface ObjectLabel {
  label: string | null;
  deleted: boolean;
}

/**
 * Where a kind's name lives: the model and the one field shown (`null`: no name, only whether it still exists).
 * Soft-deleted problems keep their code but read as deleted. Kinds not listed (comment, submission_batch) are never looked up.
 */
const LABEL_FIELDS: Record<string, { model: string; field: string | null }> = {
  problem: { model: Problem.name, field: 'code' },
  tagProblem: { model: Problem.name, field: 'code' },
  contest: { model: Contest.name, field: 'key' },
  user: { model: User.name, field: 'username' },
  organization: { model: Organization.name, field: 'slug' },
  blogPost: { model: BlogPost.name, field: 'title' },
  flatpage: { model: Flatpage.name, field: 'url' },
  problemType: { model: ProblemType.name, field: 'name' },
  problemGroup: { model: ProblemGroup.name, field: 'name' },
  license: { model: License.name, field: 'key' },
  group: { model: Group.name, field: 'name' },
  submission: { model: Submission.name, field: null },
  judge: { model: Judge.name, field: 'name' },
};

/** Kinds with no name of their own: the id is the reference. */
const UNNAMED: ObjectLabel = { label: null, deleted: false };
const GONE: ObjectLabel = { label: null, deleted: true };

type LabelRow = { _id: unknown; deletedAt?: Date } & Record<string, unknown>;

/** Names for the objects of one feed page: one read per kind, never one per row. */
@Injectable()
export class AuditLabelsRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Labels keyed `${type}:${objectId}`. */
  async labels(
    objects: { type: string; objectId: string }[],
  ): Promise<Map<string, ObjectLabel>> {
    const idsByType = new Map<string, Set<string>>();
    for (const { type, objectId } of objects)
      idsByType.set(type, (idsByType.get(type) ?? new Set()).add(objectId));
    const labels = new Map<string, ObjectLabel>();
    await Promise.all(
      [...idsByType].map(async ([type, ids]) => {
        const found = await this.labelsOf(type, [...ids]);
        for (const id of ids)
          labels.set(`${type}:${id}`, found.get(id) ?? GONE);
      }),
    );
    return labels;
  }

  private labelsOf(
    type: string,
    ids: string[],
  ): Promise<Map<string, ObjectLabel>> {
    if (type === 'setting')
      return Promise.resolve(
        new Map(ids.map((key) => [key, { label: key, deleted: false }])),
      );
    if (type === 'contestParticipation') return this.participationLabels(ids);
    const source = LABEL_FIELDS[type];
    if (!source)
      return Promise.resolve(new Map(ids.map((id) => [id, UNNAMED])));
    return this.fieldLabels(source.model, source.field, ids);
  }

  private async fieldLabels(
    model: string,
    field: string | null,
    ids: string[],
  ): Promise<Map<string, ObjectLabel>> {
    const rows = await this.connection
      .model(model)
      .find(
        { _id: { $in: ids } },
        { deletedAt: 1, ...(field && { [field]: 1 }) },
      )
      .lean<LabelRow[]>()
      .exec();
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        {
          label: field ? String(row[field]) : null,
          deleted: Boolean(row.deletedAt),
        },
      ]),
    );
  }

  /** A participation is named by its contest's key, which also locates it in the admin. */
  private async participationLabels(
    ids: string[],
  ): Promise<Map<string, ObjectLabel>> {
    const participations = await this.connection
      .model(ContestParticipation.name)
      .find({ _id: { $in: ids } }, { contest: 1 })
      .lean<{ _id: unknown; contest: unknown }[]>()
      .exec();
    const contestIds = participations.map((row) => uuidStr(row.contest));
    const contests = await this.fieldLabels(Contest.name, 'key', contestIds);
    return new Map(
      participations.map((row) => [
        uuidStr(row._id),
        contests.get(uuidStr(row.contest)) ?? GONE,
      ]),
    );
  }
}
