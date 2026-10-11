import { sha256 } from '../crypto';
import { generateApiToken, parseApiToken } from './api-token';
import { generateServiceKey, isServiceKey } from './service-key';

describe('service keys', () => {
  it('are prefixed, unique and stored only as a sha256 hash', () => {
    const first = generateServiceKey();
    expect(isServiceKey(first.key)).toBe(true);
    expect(first.key).not.toBe(generateServiceKey().key);
    expect(first.hash).toBe(sha256(first.key));
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
