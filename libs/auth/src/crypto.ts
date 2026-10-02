import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function encryptionKey(hex = process.env.ENCRYPTION_KEY ?? ''): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32)
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return key;
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob: string, key: Buffer): string {
  const b = Buffer.from(blob, 'base64');
  if (b.length < 28) throw new Error('invalid ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12), {
    authTagLength: 16,
  }).setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

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
  const d = createDecipheriv(
    'aes-128-cbc',
    key.subarray(16),
    raw.subarray(9, 25),
  );
  return Buffer.concat([d.update(raw.subarray(25, -32)), d.final()]).toString(
    'utf8',
  );
}

export const legacyWebauthnHandle = (
  secretKey: string,
  profileId: number,
): Buffer =>
  createHmac('sha256', secretKey).update(`webauthn:${profileId}`).digest();
