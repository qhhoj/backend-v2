import { Binary, UUID } from 'mongodb';
import { v7 } from 'uuid';

export const newId = (): string => v7();
export const toUuid = (id: string): UUID => new UUID(id);
export const uuidStr = (value: unknown): string =>
  value instanceof Binary ? value.toUUID().toHexString() : String(value);
