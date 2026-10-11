import { isUsableClient } from './integration-clients.repository';

describe('isUsableClient', () => {
  const now = new Date('2026-10-10T09:00:00Z');
  const at = (iso: string) => new Date(iso);

  it.each([
    ['neither revoked nor expired', null, null, true],
    ['not yet expired', null, at('2026-10-10T09:00:01Z'), true],
    ['revoked', at('2026-10-01T00:00:00Z'), null, false],
    ['at the instant it expires', null, now, false],
    ['after it expired', null, at('2026-10-09T00:00:00Z'), false],
  ] as const)('%s', (_label, revokedAt, expiresAt, usable) =>
    expect(isUsableClient({ revokedAt, expiresAt }, now)).toBe(usable),
  );
});
