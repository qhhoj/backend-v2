import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProblemGroup, ProblemType } from '@libs/database';
import type { Model } from 'mongoose';
import { CatalogItemResponse } from '../core/dto/problem-meta.response';
import { RevisionsRepository } from '../core/revisions.repository';
import { CatalogAdminService } from './catalog-admin.service';
import type { CreateTaxonDto, UpdateTaxonDto } from './dto/catalog-admin.dto';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';

/** Types and groups share one shape (`name`, `fullName`) and one API. */
abstract class TaxonAdminService<
  Row extends ProblemType | ProblemGroup,
> extends CatalogAdminService<Row> {
  async list(): Promise<CatalogItemResponse[]> {
    return (await this.rows()).map((row) => CatalogItemResponse.from(row));
  }

  async create(
    userId: string,
    dto: CreateTaxonDto,
  ): Promise<CatalogItemResponse> {
    return CatalogItemResponse.from(await this.createRow(userId, dto));
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTaxonDto,
  ): Promise<CatalogItemResponse> {
    return CatalogItemResponse.from(await this.updateRow(userId, id, dto));
  }
}

@Injectable()
export class ProblemTypesAdminService extends TaxonAdminService<ProblemType> {
  constructor(
    @InjectModel(ProblemType.name) model: Model<ProblemType>,
    querier: ProblemTypesQuerier,
    revisions: RevisionsRepository,
  ) {
    super(model, querier, revisions, {
      entity: 'problemType',
      uniqueField: 'name',
      label: 'problem type',
    });
  }
}

@Injectable()
export class ProblemGroupsAdminService extends TaxonAdminService<ProblemGroup> {
  constructor(
    @InjectModel(ProblemGroup.name) model: Model<ProblemGroup>,
    querier: ProblemGroupsQuerier,
    revisions: RevisionsRepository,
  ) {
    super(model, querier, revisions, {
      entity: 'problemGroup',
      uniqueField: 'name',
      label: 'problem group',
    });
  }
}
