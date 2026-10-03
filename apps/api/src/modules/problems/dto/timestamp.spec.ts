import { isTimestamp } from './timestamp';

describe('isTimestamp', () => {
  it.each([
    '2026-01-01T00:00:00Z',
    '2026-01-01T07:00:00+07:00',
    '2026-01-01T07:00:00.250-05:30',
    '2028-02-29T12:00Z',
  ])('accepts %s', (value) => expect(isTimestamp(value)).toBe(true));

  it.each([
    '2026-W01',
    '2026-001',
    '2026-W01-1T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-01-01T00:00:00',
    '2026-01-01',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00+25:00',
    '2027-02-29T00:00:00Z',
    1,
  ])('rejects %s', (value) => expect(isTimestamp(value)).toBe(false));
});
