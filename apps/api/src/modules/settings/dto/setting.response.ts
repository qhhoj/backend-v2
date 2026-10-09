import { ApiProperty } from '@nestjs/swagger';
import { ANY_JSON_VALUE } from './any-json-value';
import { sameJson } from '@libs/common';
import { redactSetting, SETTING_KEYS } from '@libs/settings';
import type { SettingKey } from '@libs/settings';
import type { SettingDefinition } from '@libs/settings';

export class SettingResponse {
  @ApiProperty({ enum: SETTING_KEYS, enumName: 'SettingKey' })
  key!: SettingKey;
  description!: string;
  /** True when the value holds a secret; its secret parts read `{set: boolean}`. */
  hasSecret!: boolean;
  @ApiProperty(ANY_JSON_VALUE)
  value!: unknown;
  /** The registry default, redacted like `value`: a secret default reads `{set: boolean}`. */
  @ApiProperty(ANY_JSON_VALUE)
  default!: unknown;
  /** True while the value equals the registry default (also after a patch back to it). */
  isDefault!: boolean;
  updatedAt!: Date | null;
  updatedBy!: string | null;

  static of(
    key: SettingKey,
    definition: SettingDefinition<unknown>,
    shown: { value: unknown; redacted: unknown },
    row: { updatedAt: Date; updatedBy: string | null } | undefined,
  ): SettingResponse {
    return {
      key,
      description: definition.description,
      hasSecret: definition.secret !== false,
      value: shown.redacted,
      default: redactSetting(definition, definition.default),
      isDefault: sameJson(shown.value, definition.default),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }
}
