import { isUuidV7 } from '@libs/database';

/** The 16 bytes of a user id, the front of every token. */
export const userIdBytes = (userId: string): Buffer =>
  Buffer.from(userId.replaceAll('-', ''), 'hex');

/** The user id in the first 16 bytes of `raw`, or null when they are not a version-7 id. */
export function userIdFromBytes(raw: Buffer): string | null {
  const hex = raw.subarray(0, 16).toString('hex');
  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return isUuidV7(userId) ? userId : null;
}
