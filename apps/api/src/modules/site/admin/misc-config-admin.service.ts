import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import type { Paginated } from '@libs/common';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { MiscConfigQuerier } from '../public/misc-config.querier';
import type { FlatpageRevisionResponse } from './dto/flatpage-revision.response';
import { MiscConfigResponse } from './dto/misc-config.response';
import { FlatpageHistoryService } from './flatpage-history.service';
import { configEntityId } from './misc-config-history';
import { MiscConfigRepository } from './misc-config.repository';

/** Staff writes for misc config, which `GET /site` serves to everyone: never a secret. Each write that changes a value records a revision (legacy `MiscConfig` had reversion history). */
@Injectable()
export class MiscConfigAdminService {
  constructor(
    private readonly config: MiscConfigRepository,
    private readonly querier: MiscConfigQuerier,
    private readonly revisions: RevisionsRepository,
    private readonly history: FlatpageHistoryService,
  ) {}

  async put(
    principal: Principal,
    key: string,
    value: string,
  ): Promise<MiscConfigResponse> {
    const before = await this.config.valueOf(key);
    await this.config.upsert(key, value);
    if (before !== value)
      await this.record(principal, key, before === null ? 'create' : 'edit', {
        before,
        after: value,
      });
    await this.querier.resync();
    return { key, value };
  }

  async delete(principal: Principal, key: string): Promise<void> {
    const before = await this.config.valueOf(key);
    if (before === null || !(await this.config.delete(key)))
      throw new AppError('not_found', 404, 'No such key');
    await this.record(principal, key, 'delete', { before, after: null });
    await this.querier.resync();
  }

  /** Also readable for a deleted key: the history is keyed by the key, not by a row. */
  revisionsOf(
    key: string,
    page: number,
  ): Promise<Paginated<FlatpageRevisionResponse>> {
    return this.history.entityHistory('miscConfig', configEntityId(key), page);
  }

  private record(
    principal: Principal,
    key: string,
    action: 'create' | 'edit' | 'delete',
    value: { before: string | null; after: string | null },
  ): Promise<void> {
    return this.revisions.append({
      entity: 'miscConfig',
      entityId: configEntityId(key),
      action,
      userId: principal.userId,
      changes: { value },
      comment: key,
    });
  }
}
