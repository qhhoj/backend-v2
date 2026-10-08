import { activityFilter } from './activity-filter';

describe('activityFilter', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('limits rows to the last N days', () => {
    expect(activityFilter({ days: 7, scope: { kind: 'any' } }, now).at).toEqual(
      { $gte: new Date('2026-10-01T12:00:00Z') },
    );
  });

  it('scopes to anonymous visitors or to resolved users', () => {
    expect(
      activityFilter({ days: 1, scope: { kind: 'anonymous' } }, now).userId,
    ).toBeNull();
    expect(
      activityFilter(
        { days: 1, scope: { kind: 'users', ids: ['a', 'b'] } },
        now,
      ).userId,
    ).toEqual({ $in: ['a', 'b'] });
    expect(
      activityFilter({ days: 1, scope: { kind: 'any' } }, now),
    ).not.toHaveProperty('userId');
  });

  it('matches ip prefixes and path fragments literally, case-insensitively for paths', () => {
    const filter = activityFilter(
      { days: 1, scope: { kind: 'any' }, ip: '10.0.', path: 'a.b(c' },
      now,
    );
    expect((filter.ip as RegExp).test('10.0.0.1')).toBe(true);
    expect((filter.ip as RegExp).test('110.0.0.1')).toBe(false);
    expect((filter.ip as RegExp).test('10x0.0.1')).toBe(false);
    expect((filter.path as RegExp).test('/X/A.B(C/y')).toBe(true);
    expect((filter.path as RegExp).test('/x/aXb(c')).toBe(false);
  });
});
