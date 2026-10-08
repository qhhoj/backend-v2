import { decrypt, encrypt } from '@libs/common';
import type { SettingDefinition } from './registry';
import { isPlainObject } from './setting-types';

type Fields = Record<string, unknown>;
const json = (value: unknown) => JSON.stringify(value);

/** The only place a secret is encrypted: `true` seals the whole value, a list seals those fields of an object value. */
export function sealSetting(
  definition: SettingDefinition<unknown>,
  value: unknown,
  key: Buffer,
): unknown {
  const { secret } = definition;
  if (secret === true) return encrypt(json(value), key);
  if (secret === false) return value;
  const fields = value as Fields;
  return {
    ...fields,
    ...Object.fromEntries(
      secret.map((field) => [field, encrypt(json(fields[field]), key)]),
    ),
  };
}

export function openSetting(
  definition: SettingDefinition<unknown>,
  stored: unknown,
  key: Buffer,
): unknown {
  const { secret } = definition;
  if (secret === true) return JSON.parse(decrypt(stored as string, key));
  if (secret === false) return stored;
  const fields = stored as Fields;
  return {
    ...fields,
    ...Object.fromEntries(
      secret.map((field) => [
        field,
        JSON.parse(decrypt(fields[field] as string, key)),
      ]),
    ),
  };
}

/** Opens and validates a stored row; throws when it is corrupt, sealed with another key or no longer valid. */
export const readSetting = (
  definition: SettingDefinition<unknown>,
  stored: unknown,
  key: Buffer,
): unknown => definition.type.parse(openSetting(definition, stored, key));

/** What an admin or a revision row may see: a secret becomes `{set: boolean}` (set = differs from the default). */
export function redactSetting(
  definition: SettingDefinition<unknown>,
  value: unknown,
): unknown {
  const { secret } = definition;
  if (secret === false) return value;
  if (secret === true) return { set: json(value) !== json(definition.default) };
  const fields = value as Fields;
  return {
    ...fields,
    ...Object.fromEntries(
      secret.map((field) => [field, { set: fields[field] !== '' }]),
    ),
  };
}

/** Top-level fields whose value differs (`['value']` for a scalar): a rotated secret is visible without its value. */
export function changedFields(before: unknown, after: unknown): string[] {
  if (isPlainObject(before) && isPlainObject(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (field) => json(before[field]) !== json(after[field]),
    );
  return json(before) === json(after) ? [] : ['value'];
}
