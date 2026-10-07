import { contestSubmissionPoints } from './contest-points';

describe('contestSubmissionPoints (legacy update_contest)', () => {
  const quarter = { casePoints: 1, caseTotal: 4 };
  const full = { casePoints: 4, caseTotal: 4 };
  it.each([
    ['partial contest problem and problem', quarter, true, 'default', true, 25],
    ['non-partial contest problem', quarter, false, 'default', true, 0],
    ['non-partial problem', quarter, true, 'icpc', false, 0],
    ['full marks are never zeroed', full, false, 'default', false, 100],
    ['FSO is always partial', quarter, false, 'final_submission', false, 25],
    [
      'no cases score nothing',
      { casePoints: 0, caseTotal: 0 },
      true,
      'default',
      true,
      0,
    ],
  ] as const)(
    '%s',
    (_case, totals, partial, formatName, problemPartial, points) =>
      expect(
        contestSubmissionPoints(
          totals,
          { points: 100, partial },
          formatName,
          problemPartial,
        ),
      ).toBe(points),
  );

  it('rounds to three decimals like the submission points', () =>
    expect(
      contestSubmissionPoints(
        { casePoints: 1, caseTotal: 3 },
        { points: 100, partial: true },
        'default',
        true,
      ),
    ).toBe(33.333));
});
