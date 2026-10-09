import { sha256 } from '../crypto';
import { generateApiToken, parseApiToken } from './api-token';
import {
  generateServiceKey,
  isServiceKey,
  SERVICE_KEY_PREFIX,
} from './service-key';

describe('service keys', () => {
  it('are prefixed, 47 characters, unique, and hashed with sha256 only', () => {
    const first = generateServiceKey();
    const second = generateServiceKey();
    expect(first.key.startsWith(SERVICE_KEY_PREFIX)).toBe(true);
    expect(first.key).toHaveLength(47);
    expect(isServiceKey(first.key)).toBe(true);
    expect(first.key).not.toBe(second.key);
    expect(first.hash).toBe(sha256(first.key));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).not.toContain(first.key);
  });
  it('are never mistaken for a user API token, and a user token is never a service key', () => {
    const { key } = generateServiceKey();
    expect(parseApiToken(key)).toBeNull();
    const user = generateApiToken(
      '0190a000-0000-7000-8000-000000000001',
      'secret',
    );
    expect(isServiceKey(user.token)).toBe(false);
  });
  it.each([
    '',
    'qhi_',
    'qhi_short',
    `qhi_${'a'.repeat(44)}`,
    `QHI_${'a'.repeat(43)}`,
    `xqhi_${'a'.repeat(43)}`,
    `qhi_${'a'.repeat(42)}!`,
  ])('refuses the malformed value %j', (value) => {
    expect(isServiceKey(value)).toBe(false);
  });
});
