import { Injectable } from '@nestjs/common';
import { AppError } from '@libs/common';
import { MiscConfigQuerier } from '../public/misc-config.querier';
import { MiscConfigResponse } from './dto/misc-config.response';
import { MiscConfigRepository } from './misc-config.repository';

/** Staff writes for misc config, which `GET /site` serves to everyone: never a secret. */
@Injectable()
export class MiscConfigAdminService {
  constructor(
    private readonly config: MiscConfigRepository,
    private readonly querier: MiscConfigQuerier,
  ) {}

  async put(key: string, value: string): Promise<MiscConfigResponse> {
    await this.config.upsert(key, value);
    await this.querier.resync();
    return { key, value };
  }

  async delete(key: string): Promise<void> {
    if (!(await this.config.delete(key)))
      throw new AppError('not_found', 404, 'No such key');
    await this.querier.resync();
  }
}
