import { isUsableClient } from './integration-clients.repository';

describe('isUsableClient', () => {
  const now = new Date('2026-10-10T09:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('accepts a key that is neither revoked nor expired', () => {
    expect(isUsableClient({ revokedAt: null, expiresAt: null }, now)).toBe(
      true,
    );
    expect(
      isUsableClient(
        { revokedAt: null, expiresAt: at('2026-10-10T09:00:01Z') },
        now,
      ),
    ).toBe(true);
  });

  it('refuses a revoked key, whatever its expiry', () => {
    expect(
      isUsableClient(
        { revokedAt: at('2026-10-01T00:00:00Z'), expiresAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('refuses a key from the instant it expires', () => {
    expect(isUsableClient({ revokedAt: null, expiresAt: now }, now)).toBe(
      false,
    );
    expect(
      isUsableClient(
        { revokedAt: null, expiresAt: at('2026-10-09T00:00:00Z') },
        now,
      ),
    ).toBe(false);
  });
});
