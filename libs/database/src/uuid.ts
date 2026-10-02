import { Binary, UUID } from 'mongodb';
import { v7 } from 'uuid';

export const newId = (): string => v7();
export const toUuid = (id: string): UUID => new UUID(id);
export const uuidStr = (v: unknown): string =>
  v instanceof Binary ? v.toUUID().toHexString() : String(v);
