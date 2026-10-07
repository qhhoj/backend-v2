import { generateRankingToken, isLinkValid, linkExpiry } from './ranking-link';

describe('ranking links', () => {
  const regeneratedAt = new Date('2026-01-01T00:00:00Z');

  it('makes 18-character alphanumeric tokens that differ', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateRankingToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9]{18}$/);
  });

  it('expires never, after minutes or days from the last regeneration, or at a date', () => {
    expect(
      linkExpiry(
        { expiryMode: 'U', expiryAmount: null, expiresAt: null },
        regeneratedAt,
      ),
    ).toBeNull();
    expect(
      linkExpiry(
        { expiryMode: 'M', expiryAmount: 90, expiresAt: null },
        regeneratedAt,
      ),
    ).toEqual(new Date('2026-01-01T01:30:00Z'));
    expect(
      linkExpiry(
        { expiryMode: 'D', expiryAmount: 2, expiresAt: null },
        regeneratedAt,
      ),
    ).toEqual(new Date('2026-01-03T00:00:00Z'));
    const at = new Date('2026-02-01T00:00:00Z');
    expect(
      linkExpiry(
        { expiryMode: 'A', expiryAmount: null, expiresAt: at },
        regeneratedAt,
      ),
    ).toEqual(at);
  });

  it('is valid while public and not past its expiry (inclusive)', () => {
    const expiresAt = new Date('2026-01-01T01:00:00Z');
    expect(isLinkValid({ status: 'public', expiresAt }, expiresAt)).toBe(true);
    expect(
      isLinkValid(
        { status: 'public', expiresAt },
        new Date(expiresAt.getTime() + 1),
      ),
    ).toBe(false);
    expect(
      isLinkValid({ status: 'private', expiresAt: null }, regeneratedAt),
    ).toBe(false);
    expect(
      isLinkValid({ status: 'public', expiresAt: null }, regeneratedAt),
    ).toBe(true);
  });
});
