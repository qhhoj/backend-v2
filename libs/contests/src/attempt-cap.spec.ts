import { attemptCap } from './attempt-cap';

describe('attemptCap', () => {
  it.each([
    { stored: 3, cap: 3 },
    { stored: 99_999, cap: 99_999 },
    { stored: null, cap: null },
    { stored: 0, cap: null },
    { stored: 226_789, cap: null },
  ])('stored $stored gives cap $cap', ({ stored, cap }) => {
    expect(attemptCap(stored)).toBe(cap);
  });
});
