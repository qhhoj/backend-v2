import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { License } from '@libs/database';
import type { Model } from 'mongoose';
import { RevisionsRepository } from '../core/revisions.repository';
import { CatalogAdminService } from './catalog-admin.service';
import type {
  CreateLicenseDto,
  UpdateLicenseDto,
} from './dto/catalog-admin.dto';
import { LicenseAdminResponse } from './dto/license-admin.response';
import { LicensesQuerier } from './licenses.querier';

@Injectable()
export class LicensesAdminService extends CatalogAdminService<License> {
  constructor(
    @InjectModel(License.name) model: Model<License>,
    querier: LicensesQuerier,
    revisions: RevisionsRepository,
  ) {
    super(model, querier, revisions, {
      entity: 'license',
      uniqueField: 'key',
      label: 'license',
    });
  }

  async list(): Promise<LicenseAdminResponse[]> {
    return (await this.rows()).map((row) => LicenseAdminResponse.fromRow(row));
  }

  async create(
    userId: string,
    dto: CreateLicenseDto,
  ): Promise<LicenseAdminResponse> {
    return LicenseAdminResponse.fromRow(await this.createRow(userId, dto));
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateLicenseDto,
  ): Promise<LicenseAdminResponse> {
    return LicenseAdminResponse.fromRow(await this.updateRow(userId, id, dto));
  }
}
