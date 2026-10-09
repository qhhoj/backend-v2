import {
  canonicalTimeZone,
  isTimeZone,
  monthKeyIn,
  startOfDayIn,
} from './time-zone';

describe('canonicalTimeZone', () => {
  it('gives one ID per zone whatever the spelling or alias', () => {
    const canonical = canonicalTimeZone('Asia/Ho_Chi_Minh');
    expect(canonical).toMatch(/^Asia\/(Ho_Chi_Minh|Saigon)$/);
    expect(canonicalTimeZone('asia/ho_chi_minh')).toBe(canonical);
    expect(canonicalTimeZone('Asia/Saigon')).toBe(canonical);
    expect(canonicalTimeZone('utc')).toBe('UTC');
    expect(canonicalTimeZone('Mars/Base')).toBeNull();
  });
});

describe('isTimeZone', () => {
  it('accepts IANA names and UTC', () => {
    for (const zone of [
      'Asia/Ho_Chi_Minh',
      'America/Toronto',
      'UTC',
      'America/Argentina/Buenos_Aires',
    ])
      expect(isTimeZone(zone)).toBe(true);
  });

  it('refuses unknown names, offsets and non-strings', () => {
    for (const value of [
      'Mars/Base',
      '',
      '+07:00',
      'Asia/Ho_Chi_Minh\0',
      7,
      null,
    ])
      expect(isTimeZone(value)).toBe(false);
  });
});

describe('startOfDayIn', () => {
  const iso = (value: Date) => value.toISOString();
  it('is the zone midnight of the zone date, not of the UTC date', () => {
    expect(
      iso(startOfDayIn('Asia/Ho_Chi_Minh', new Date('2026-10-08T20:00:00Z'))),
    ).toBe('2026-10-08T17:00:00.000Z');
    expect(
      iso(
        startOfDayIn('Asia/Ho_Chi_Minh', new Date('2026-10-08T16:59:59.999Z')),
      ),
    ).toBe('2026-10-07T17:00:00.000Z');
    expect(
      iso(
        startOfDayIn('America/Los_Angeles', new Date('2026-10-08T03:00:00Z')),
      ),
    ).toBe('2026-10-07T07:00:00.000Z');
  });
  it('is exact across daylight-saving changes', () => {
    // US fall back: midnight of 2026-11-01 is still EDT (UTC-4)
    expect(
      iso(startOfDayIn('America/New_York', new Date('2026-11-01T12:00:00Z'))),
    ).toBe('2026-11-01T04:00:00.000Z');
    // US spring forward: midnight of 2026-03-08 is EST (UTC-5)
    expect(
      iso(startOfDayIn('America/New_York', new Date('2026-03-08T18:00:00Z'))),
    ).toBe('2026-03-08T05:00:00.000Z');
  });
  it('moves back exactly one millisecond across the boundary', () => {
    const start = startOfDayIn(
      'Europe/Paris',
      new Date('2026-06-15T10:00:00Z'),
    );
    expect(startOfDayIn('Europe/Paris', start).getTime()).toBe(start.getTime());
    expect(
      startOfDayIn('Europe/Paris', new Date(start.getTime() - 1)).getTime(),
    ).toBeLessThan(start.getTime());
  });
});

describe('monthKeyIn', () => {
  it('names the zone calendar month, not the UTC one', () => {
    const lastMinuteOfSeptemberUtc = new Date('2026-09-30T23:59:00Z');
    expect(monthKeyIn('UTC', lastMinuteOfSeptemberUtc)).toBe('2026-09');
    expect(monthKeyIn('Asia/Ho_Chi_Minh', lastMinuteOfSeptemberUtc)).toBe(
      '2026-10',
    );
    expect(
      monthKeyIn('America/Toronto', new Date('2026-10-01T03:00:00Z')),
    ).toBe('2026-09');
  });
  it('rolls the year over in the zone, ahead of or behind UTC', () => {
    const newYearsEveUtc = new Date('2025-12-31T23:59:59Z');
    expect(monthKeyIn('Pacific/Kiritimati', newYearsEveUtc)).toBe('2026-01');
    expect(
      monthKeyIn('Pacific/Honolulu', new Date('2026-01-01T05:00:00Z')),
    ).toBe('2025-12');
  });
});
