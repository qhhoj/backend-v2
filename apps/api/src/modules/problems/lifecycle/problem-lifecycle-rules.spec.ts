import { daysLeft } from './problem-lifecycle-rules';

describe('daysLeft', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const ago = (milliseconds: number) => new Date(now.getTime() - milliseconds);
  const DAY = 86_400_000;

  it.each([
    ['just deleted', 1, 30, 30],
    ['a day and a bit in', DAY + 1000, 30, 29],
    ['the last started day', 29 * DAY + 1, 30, 1],
    ['exactly at the end of the grace period', 30 * DAY, 30, 0],
    ['long past it', 90 * DAY, 30, 0],
    ['a shorter grace period', 2 * DAY, 10, 8],
  ])('%s', (_name, age, grace, expected) => {
    expect(daysLeft(ago(age), grace, now)).toBe(expected);
  });
});
