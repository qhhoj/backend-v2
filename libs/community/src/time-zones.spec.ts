import { canonicalTimeZone, isTimeZone } from './time-zones';

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
