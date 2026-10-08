import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptionKey(hex = process.env.ENCRYPTION_KEY ?? ''): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (!/^[0-9a-f]{64}$/i.test(hex) || key.length !== 32)
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return key;
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    'base64',
  );
}

export function decrypt(blob: string, key: Buffer): string {
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < 28) throw new Error('invalid ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), {
    authTagLength: 16,
  }).setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}
