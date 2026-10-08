import { sameJson } from '@libs/common';
import type { SettingDefinition } from '@libs/settings';

export class SettingResponse {
  key!: string;
  description!: string;
  /** True when the value holds a secret; its secret parts read `{set: boolean}`. */
  hasSecret!: boolean;
  value!: unknown;
  /** True while the value equals the registry default (also after a patch back to it). */
  isDefault!: boolean;
  updatedAt!: Date | null;
  updatedBy!: string | null;

  static of(
    key: string,
    definition: SettingDefinition<unknown>,
    value: unknown,
    redacted: unknown,
    row: { updatedAt: Date; updatedBy: string | null } | undefined,
  ): SettingResponse {
    return {
      key,
      description: definition.description,
      hasSecret: definition.secret !== false,
      value: redacted,
      isDefault: sameJson(value, definition.default),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }
}
