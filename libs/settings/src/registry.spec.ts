import { definitionOf, secretsUnboundBy, SETTING_KEYS } from './registry';

const BASE_URL = 'externalJudge.baseUrl';
const TOKEN = 'externalJudge.apiToken';

describe('secretsUnboundBy', () => {
  it.each([
    ['https://pcd.test/base', 'https://other.test/base'],
    ['https://pcd.test', 'http://pcd.test'],
    ['https://pcd.test', 'https://pcd.test:8443'],
    ['', 'https://pcd.test'],
    ['https://pcd.test', ''],
  ])('resets the token when the base URL moves from %p to %p', (from, to) => {
    expect(secretsUnboundBy(BASE_URL, from, to)).toEqual([TOKEN]);
  });

  it('keeps the token for a new path on the same origin, and for other settings', () => {
    expect(
      secretsUnboundBy(
        BASE_URL,
        'https://pcd.test/base',
        'https://pcd.test/v2',
      ),
    ).toEqual([]);
    expect(secretsUnboundBy(BASE_URL, '', '')).toEqual([]);
    expect(
      secretsUnboundBy('auth.pwnedApiUrl', 'https://a.test', 'https://b.test'),
    ).toEqual([]);
  });

  it('names only secret settings as origin-bound', () => {
    for (const key of SETTING_KEYS)
      for (const bound of definitionOf(key)?.originBoundSecrets ?? [])
        expect(definitionOf(bound)?.secret).toBe(true);
  });
});
