import { Binary, UUID } from 'mongodb';
import { v7 } from 'uuid';

export const newId = (): string => v7();
export const toUuid = (id: string): UUID => new UUID(id);
const isUuidBinary = (value: unknown): value is Binary =>
  value instanceof Binary ||
  typeof (value as { toUUID?: unknown } | null)?.toUUID === 'function';

export const uuidStr = (value: unknown): string =>
  isUuidBinary(value) ? value.toUUID().toHexString() : String(value);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Mirrors Mongoose's UUID cast format (version nibble 0-9, variant 8-b). Guards casts: a malformed id is "not found", never a Mongoose CastError. */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
