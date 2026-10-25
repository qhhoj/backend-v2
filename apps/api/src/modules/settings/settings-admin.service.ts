import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, Paginated } from '@libs/common';
import {
  definitionOf,
  redactSetting,
  restorableValue,
  SettingError,
  SETTING_KEYS,
  SettingsService,
  shownRevisionValue,
} from '@libs/settings';
import type { SettingKey } from '@libs/settings';
import { SettingResponse } from './dto/setting.response';
import { SettingRevisionResponse } from './dto/setting-revision.response';
import {
  assertSettingAccess,
  isSettingVisibleTo,
} from './superuser-only-settings';

@Injectable()
export class SettingsAdminService {
  constructor(private readonly settings: SettingsService) {}

  /** Superuser-only keys are left out for other users. */
  async list(actor: Principal): Promise<SettingResponse[]> {
    const rows = await this.settings.rows();
    return SETTING_KEYS.filter((key) => isSettingVisibleTo(key, actor)).map(
      (key) => this.view(key, rows.get(key)),
    );
  }

  async update(
    key: string,
    value: unknown,
    actor: Principal,
  ): Promise<SettingResponse> {
    const known = this.accessible(key, actor);
    try {
      await this.settings.set(known, value, actor.userId);
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
    actor: Principal,
  ): Promise<SettingResponse> {
    const known = this.accessible(key, actor);
    const revision = await this.settings.revisionOf(known, revisionId);
    if (!revision) throw new AppError('not_found', 404, 'No such revision');
    const value = restorableValue(definitionOf(known)!, revision.before);
    if (value === undefined)
      throw new AppError(
        'secret_unrestorable',
        409,
        'Secret values are not stored in revisions',
      );
    return this.update(known, value, actor);
  }

  async revisions(
    key: string,
    actor: Principal,
    page: number,
    pageSize: number,
  ) {
    const { items, total } = await this.settings.revisionsOf(
      this.accessible(key, actor),
      page,
      pageSize,
    );
    const definition = definitionOf(key)!;
    return new Paginated(
      items.map((item) =>
        SettingRevisionResponse.from({
          ...item,
          before: shownRevisionValue(definition, item.before),
          after: shownRevisionValue(definition, item.after),
        }),
      ),
      { page, pageSize, total },
    );
  }

  private known(key: string): SettingKey {
    if (!definitionOf(key))
      throw new AppError('not_found', 404, 'No such setting');
    return key as SettingKey;
  }

  private accessible(key: string, actor: Principal): SettingKey {
    const known = this.known(key);
    assertSettingAccess(known, actor);
    return known;
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
