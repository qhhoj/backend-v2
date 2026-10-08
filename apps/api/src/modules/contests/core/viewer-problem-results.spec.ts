import { viewerProblemResults } from './viewer-problem-results';

describe('viewerProblemResults', () => {
  const problems = [
    { problemId: 'p1', points: 100 },
    { problemId: 'p2', points: 50 },
  ];

  it('counts attempts as the submission cap does and flags submissions still waiting for a verdict', () => {
    const results = viewerProblemResults({
      problems,
      cells: { p1: { time: 60, points: 100 } },
      submissions: [
        { problem: 'p1', status: 'D' },
        { problem: 'p1', status: 'CE' },
        { problem: 'p1', status: 'IE' },
        { problem: 'p1', status: 'PD' },
        { problem: 'p2', status: 'D' },
      ],
    });
    expect(results.get('p1')).toEqual({
      cell: { time: 60, points: 100 },
      isSolved: true,
      attempts: 2,
      hasPendingSubmission: true,
    });
    expect(results.get('p2')).toEqual({
      cell: null,
      isSolved: false,
      attempts: 1,
      hasPendingSubmission: false,
    });
  });

  it.each(['QU', 'P', 'G', 'PD'] as const)(
    'treats %s as waiting for a verdict',
    (status) =>
      expect(
        viewerProblemResults({
          problems,
          cells: {},
          submissions: [{ problem: 'p2', status }],
        }).get('p2')!.hasPendingSubmission,
      ).toBe(true),
  );

  it('solves a problem only with a cell worth its full points', () =>
    expect(
      viewerProblemResults({
        problems,
        cells: { p2: { points: 49.5 } },
        submissions: [],
      }).get('p2')!.isSolved,
    ).toBe(false));
});
