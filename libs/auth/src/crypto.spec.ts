import fixtures from '../../../test/fixtures/django.json';
import {
  legacyFernetDecrypt,
  constantTimeEqual,
  legacyWebauthnHandle,
} from './crypto';

describe('crypto', () => {
  it('compares strings in constant time and rejects non-strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    for (const given of ['abd', 'ab', 'abcd', '', undefined, 123, ['abc']])
      expect(constantTimeEqual(given, 'abc')).toBe(false);
  });
  it.each(fixtures.fernet)(
    'decrypts django-fernet-fields token for $plain',
    ({ plain, cipher }) =>
      expect(legacyFernetDecrypt(cipher, fixtures.secretKey)).toBe(plain),
  );
  it('rejects fernet tokens with a bad signature', () =>
    expect(() =>
      legacyFernetDecrypt(fixtures.fernet[0].cipher, 'other-secret'),
    ).toThrow(/invalid fernet token/));
  it.each(fixtures.webauthnHandles)(
    'matches webauthn handle for profile $profileId',
    ({ profileId, handle }) =>
      expect(
        legacyWebauthnHandle(fixtures.secretKey, profileId).toString('hex'),
      ).toBe(handle),
  );
});
