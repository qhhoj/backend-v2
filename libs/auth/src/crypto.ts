import {
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** django-fernet-fields: Fernet key = HKDF-SHA256(SECRET_KEY); token = 0x80‖ts8‖iv16‖AES-128-CBC‖HMAC32. No TTL. */
export function legacyFernetDecrypt(token: string, secretKey: string): string {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      secretKey,
      'django-fernet-fields-hkdf-salt',
      'django-fernet-fields',
      32,
    ),
  );
  const raw = Buffer.from(token, 'base64url');
  const mac = createHmac('sha256', key.subarray(0, 16))
    .update(raw.subarray(0, -32))
    .digest();
  if (
    raw.length < 73 ||
    raw[0] !== 0x80 ||
    !timingSafeEqual(mac, raw.subarray(-32))
  )
    throw new Error('invalid fernet token');
  const decipher = createDecipheriv(
    'aes-128-cbc',
    key.subarray(16),
    raw.subarray(9, 25),
  );
  return Buffer.concat([
    decipher.update(raw.subarray(25, -32)),
    decipher.final(),
  ]).toString('utf8');
}

export const legacyWebauthnHandle = (
  secretKey: string,
  profileId: number,
): Buffer =>
  createHmac('sha256', secretKey).update(`webauthn:${profileId}`).digest();

export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** Constant-time string compare; false for non-strings. */
export const constantTimeEqual = (left: unknown, right: string): boolean => {
  if (typeof left !== 'string') return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};
