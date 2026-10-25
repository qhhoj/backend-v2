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

/** Decision 416: `judge.change_settings` is operator-grade, but these keys hold mail credentials, sign-in and the role every organization admin gets, so only a superuser may change them. */
const isSuperuserOnly = (key: SettingKey): boolean =>
  key === 'mail.smtpUrl' ||
  key === 'organization.adminRoleId' ||
  key.startsWith('auth.');

const superuserOnly = () => {
  const message = 'Only a superuser may change this setting';
  return new AppError('forbidden', 403, message, undefined, undefined, {
    issues: [{ field: 'key', code: 'superuser_only', message }],
  });
};

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
    actor: Principal,
  ): Promise<SettingResponse> {
    const known = this.writable(key, actor);
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
    const known = this.writable(key, actor);
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

  async revisions(key: string, page: number, pageSize: number) {
    const { items, total } = await this.settings.revisionsOf(
      this.known(key),
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

  private writable(key: string, actor: Principal): SettingKey {
    const known = this.known(key);
    if (isSuperuserOnly(known) && !actor.isSuperuser) throw superuserOnly();
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
