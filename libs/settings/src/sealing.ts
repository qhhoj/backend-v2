import { decrypt, encrypt } from '@libs/common';
import type { SettingDefinition } from './registry';
import { isPlainObject, SettingError } from './setting-types';

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

/** Throws a fixed-text `SettingError` naming the key: the underlying decrypt or JSON error can quote decrypted text. */
export function openSetting(
  settingKey: string,
  definition: SettingDefinition<unknown>,
  stored: unknown,
  key: Buffer,
): unknown {
  const { secret } = definition;
  const open = (sealed: unknown) =>
    JSON.parse(decrypt(sealed as string, key)) as unknown;
  try {
    if (secret === true) return open(stored);
    if (secret === false) return stored;
    const fields = stored as Fields;
    return {
      ...fields,
      ...Object.fromEntries(
        secret.map((field) => [field, open(fields[field])]),
      ),
    };
  } catch {
    throw new SettingError(`Setting ${settingKey} cannot be opened`);
  }
}

/** Opens and validates a stored row; throws when it is corrupt, sealed with another key or no longer valid. */
export const readSetting = (
  settingKey: string,
  definition: SettingDefinition<unknown>,
  stored: unknown,
  key: Buffer,
): unknown =>
  definition.type.parse(openSetting(settingKey, definition, stored, key));

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
