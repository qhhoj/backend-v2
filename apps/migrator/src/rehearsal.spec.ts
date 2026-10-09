import { legacySecretsSkipped, setSkipLegacySecrets } from './rehearsal';

describe('setSkipLegacySecrets', () => {
  afterEach(() => {
    delete process.env.MIGRATION_REHEARSAL;
    setSkipLegacySecrets(false);
  });

  it('refuses the skip unless MIGRATION_REHEARSAL=1', () => {
    process.env.MIGRATION_REHEARSAL = 'true';
    expect(() => setSkipLegacySecrets(true)).toThrow(
      'needs MIGRATION_REHEARSAL=1',
    );
    expect(legacySecretsSkipped()).toBe(false);
  });

  it('skips under MIGRATION_REHEARSAL=1 and turns back off', () => {
    process.env.MIGRATION_REHEARSAL = '1';
    setSkipLegacySecrets(true);
    expect(legacySecretsSkipped()).toBe(true);
    setSkipLegacySecrets(false);
    expect(legacySecretsSkipped()).toBe(false);
  });
});
