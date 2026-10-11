import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  BlogPost,
  Contest,
  Flatpage,
  Organization,
  Problem,
  Revision,
  User,
  uuidStr,
} from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';

type AnyRow = Record<string, unknown>;
/** The field that names an entity of each kind; kinds missing here have no label. */
interface LabelSource {
  model: Model<AnyRow>;
  field: string;
}
const source = <T>(model: Model<T>, field: keyof T & string): LabelSource => ({
  model: model as unknown as Model<AnyRow>,
  field,
});

/** The site-wide revision feed and the names of the rows it points at. Deleted problems keep their code, so labels read them too. */
@Injectable()
export class AuditFeedRepository {
  private readonly labelSources: Record<string, LabelSource>;

  constructor(
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(Problem.name) problems: Model<Problem>,
    @InjectModel(Contest.name) contests: Model<Contest>,
    @InjectModel(BlogPost.name) posts: Model<BlogPost>,
    @InjectModel(Flatpage.name) pages: Model<Flatpage>,
    @InjectModel(User.name) users: Model<User>,
    @InjectModel(Organization.name) organizations: Model<Organization>,
  ) {
    this.labelSources = {
      problem: source(problems, 'code'),
      contest: source(contests, 'key'),
      blogPost: source(posts, 'title'),
      flatpage: source(pages, 'url'),
      user: source(users, 'username'),
      organization: source(organizations, 'slug'),
    };
  }

  /** Newest first, through `{createdAt, _id}`. */
  async page(
    filter: FilterQuery<Revision>,
    page: number,
    pageSize: number,
  ): Promise<{ items: Revision[]; total: number }> {
    const [items, total] = await Promise.all([
      this.revisions
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Revision[]>()
        .exec(),
      Object.keys(filter).length
        ? this.revisions.countDocuments(filter).exec()
        : this.revisions.estimatedDocumentCount().exec(),
    ]);
    return { items, total };
  }

  /** `entity:id` → name, one read per kind; rows that are gone have none. */
  async labelsOf(
    rows: readonly Pick<Revision, 'entity' | 'entityId'>[],
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    await Promise.all(
      Object.entries(this.labelSources).map(async ([entity, source]) => {
        const ids = [
          ...new Set(
            rows
              .filter((row) => row.entity === entity)
              .map((row) => uuidStr(row.entityId)),
          ),
        ];
        if (!ids.length) return;
        const found = await source.model
          .find({ _id: { $in: ids } }, { [source.field]: 1 })
          .lean<AnyRow[]>()
          .exec();
        for (const row of found)
          labels.set(
            `${entity}:${uuidStr(row._id)}`,
            String(row[source.field]),
          );
      }),
    );
    return labels;
  }
}
