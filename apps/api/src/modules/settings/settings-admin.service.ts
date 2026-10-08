import { Injectable } from '@nestjs/common';
import { AppError, invalidField, Paginated } from '@libs/common';
import {
  definitionOf,
  redactSetting,
  restorableValue,
  SettingError,
  SETTING_KEYS,
  SettingsService,
} from '@libs/settings';
import type { SettingKey } from '@libs/settings';
import { SettingResponse } from './dto/setting.response';
import { SettingRevisionResponse } from './dto/setting-revision.response';

@Injectable()
export class SettingsAdminService {
  constructor(private readonly settings: SettingsService) {}

  async list(): Promise<SettingResponse[]> {
    const rows = await this.settings.rows();
    return SETTING_KEYS.map((key) => this.view(key, rows.get(key)));
  }

  async update(
    key: string,
    value: unknown,
    actorId: string,
  ): Promise<SettingResponse> {
    const known = this.known(key);
    try {
      await this.settings.set(known, value, actorId);
    } catch (error) {
      if (error instanceof SettingError)
        throw invalidField('value', error.message);
      throw error;
    }
    return this.view(known, (await this.settings.rows()).get(known));
  }

  /** Writes the revision's `before` back through `update`, so the restore is a new revision; sealed parts are never restored. */
  async restore(
    key: string,
    revisionId: string,
    actorId: string,
  ): Promise<SettingResponse> {
    const known = this.known(key);
    const revision = await this.settings.revisionOf(known, revisionId);
    if (!revision) throw new AppError('not_found', 404, 'No such revision');
    const value = restorableValue(definitionOf(known)!, revision.before);
    if (value === null)
      throw new AppError(
        'secret_unrestorable',
        409,
        'Secret values are not stored in revisions',
      );
    return this.update(known, value, actorId);
  }

  async revisions(key: string, page: number, pageSize: number) {
    const { items, total } = await this.settings.revisionsOf(
      this.known(key),
      page,
      pageSize,
    );
    return new Paginated(
      items.map((item) => SettingRevisionResponse.from(item)),
      { page, pageSize, total },
    );
  }

  private known(key: string): SettingKey {
    if (!definitionOf(key))
      throw new AppError('not_found', 404, 'No such setting');
    return key as SettingKey;
  }

  private view(key: SettingKey, row: Parameters<typeof SettingResponse.of>[3]) {
    const definition = definitionOf(key)!;
    const value = this.settings.get(key);
    return SettingResponse.of(
      key,
      definition,
      { value, redacted: redactSetting(definition, value) },
      row,
    );
  }
}
