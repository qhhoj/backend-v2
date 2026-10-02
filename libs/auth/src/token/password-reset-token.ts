import { createHmac, timingSafeEqual } from 'node:crypto';

const RESET_TOKEN_TTL_SECONDS = 3 * 24 * 60 * 60;
const TOKEN_BYTES = 16 + 4 + 32;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ResetTokenOwner {
  id: string;
  password: string;
  lastLogin: Date | null;
}

export interface ParsedResetToken {
  userId: string;
  issuedAt: number;
  mac: Buffer;
}

const resetMac = (
  owner: ResetTokenOwner,
  issuedAt: number,
  tokenSecret: string,
) =>
  createHmac('sha256', tokenSecret)
    .update(
      `password-reset:${owner.id}:${owner.password}:${owner.lastLogin?.getTime() ?? ''}:${issuedAt}`,
    )
    .digest();

/** Stateless token bound to the current password hash and last login, so a password change or a login invalidates it. */
export function createPasswordResetToken(
  owner: ResetTokenOwner,
  tokenSecret: string,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const issuedAtBytes = Buffer.alloc(4);
  issuedAtBytes.writeUInt32BE(issuedAt);
  return Buffer.concat([
    Buffer.from(owner.id.replaceAll('-', ''), 'hex'),
    issuedAtBytes,
    resetMac(owner, issuedAt, tokenSecret),
  ]).toString('base64url');
}

export function readPasswordResetToken(token: string): ParsedResetToken | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== TOKEN_BYTES || raw.toString('base64url') !== token)
    return null;
  const hex = raw.subarray(0, 16).toString('hex');
  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_V7.test(userId)
    ? { userId, issuedAt: raw.readUInt32BE(16), mac: raw.subarray(20) }
    : null;
}

export function passwordResetTokenValid(
  token: ParsedResetToken,
  owner: ResetTokenOwner,
  tokenSecret: string,
  now = Date.now(),
): boolean {
  const age = Math.floor(now / 1000) - token.issuedAt;
  return (
    age >= 0 &&
    age <= RESET_TOKEN_TTL_SECONDS &&
    timingSafeEqual(token.mac, resetMac(owner, token.issuedAt, tokenSecret))
  );
}
