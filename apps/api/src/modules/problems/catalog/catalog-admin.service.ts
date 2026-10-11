import { AppError, isDuplicateKey } from '@libs/common';
import { uuidStr } from '@libs/database';
import { fieldDiff } from '@libs/problems';
import type { Model } from 'mongoose';
import type { RevisionsRepository } from '../core/revisions.repository';

/** What tells one catalog apart: the revision entity, its unique field and how a missing row is named in errors. */
export interface CatalogAdminConfig {
  entity: 'problemType' | 'problemGroup' | 'license';
  uniqueField: 'name' | 'key';
  label: string;
}

/** Lean rows and `toObject()` carry the binary UUID; responses and revisions want the string. */
const withStringId = <Row extends { _id: string }>(row: Row): Row => ({
  ...row,
  _id: uuidStr(row._id),
});

interface CatalogQuerier {
  resync(): Promise<void>;
}

/**
 * Staff list, create and update for one catalog (types, groups, licenses). No delete: problems reference the rows (see
 * decisions). Every write is a revision and resyncs this process's querier at once; other processes follow the change
 * stream.
 */
export abstract class CatalogAdminService<Row extends { _id: string }> {
  protected constructor(
    private readonly model: Model<Row>,
    private readonly querier: CatalogQuerier,
    private readonly revisions: RevisionsRepository,
    private readonly config: CatalogAdminConfig,
  ) {}

  /** Every row, sorted by its unique field ignoring case. */
  async rows(): Promise<Row[]> {
    const rows = await this.model
      .find()
      .collation({ locale: 'en' })
      .sort({ [this.config.uniqueField]: 1 })
      .lean<Row[]>()
      .exec();
    return rows.map(withStringId);
  }

  async createRow(userId: string, dto: object): Promise<Row> {
    const created = await this.write(() => this.model.create(dto));
    const row = withStringId(created.toObject() as Row);
    await this.afterWrite(userId, 'create', {}, row);
    return row;
  }

  async updateRow(userId: string, id: string, dto: object): Promise<Row> {
    const before = await this.model.findById(id).lean<Row>().exec();
    if (!before) throw this.notFound();
    const updated = await this.write(() =>
      this.model
        .findByIdAndUpdate(
          id,
          { $set: dto },
          { new: true, runValidators: true },
        )
        .lean<Row>()
        .exec(),
    );
    if (!updated) throw this.notFound();
    const after = withStringId(updated);
    await this.afterWrite(userId, 'edit', withStringId(before), after);
    return after;
  }

  private async afterWrite(
    userId: string,
    action: 'create' | 'edit',
    before: object,
    after: Row,
  ): Promise<void> {
    const changes = fieldDiff(before as Record<string, unknown>, after);
    if (Object.keys(changes).length)
      await this.revisions.append({
        entity: this.config.entity,
        entityId: after._id,
        action,
        userId,
        changes,
        comment: action === 'create' ? 'Created on site' : 'Edited from site',
      });
    await this.querier.resync();
  }

  private notFound(): AppError {
    return new AppError('not_found', 404, `No such ${this.config.label}`);
  }

  private async write<Result>(action: () => Promise<Result>): Promise<Result> {
    const field = this.config.uniqueField;
    try {
      return await action();
    } catch (error) {
      if (isDuplicateKey(error, field))
        throw new AppError(
          'conflict',
          409,
          `A ${this.config.label} with this ${field} exists`,
          { [field]: [`This ${field} is taken.`] },
        );
      throw error;
    }
  }
}
