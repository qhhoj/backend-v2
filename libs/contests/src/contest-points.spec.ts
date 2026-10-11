import { contestSubmissionPoints } from './contest-points';

describe('contestSubmissionPoints (legacy update_contest)', () => {
  const quarter = { casePoints: 1, caseTotal: 4 };
  const full = { casePoints: 4, caseTotal: 4 };
  it.each([
    {
      name: 'partial contest problem and problem',
      totals: quarter,
      partial: true,
      formatName: 'default',
      problemPartial: true,
      points: 25,
    },
    {
      name: 'non-partial contest problem',
      totals: quarter,
      partial: false,
      formatName: 'default',
      problemPartial: true,
      points: 0,
    },
    {
      name: 'full marks are never zeroed',
      totals: full,
      partial: false,
      formatName: 'default',
      problemPartial: false,
      points: 100,
    },
    {
      name: 'FSO is always partial',
      totals: quarter,
      partial: false,
      formatName: 'final_submission',
      problemPartial: false,
      points: 25,
    },
  ] as const)(
    '$name',
    ({ totals, partial, formatName, problemPartial, points }) =>
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
