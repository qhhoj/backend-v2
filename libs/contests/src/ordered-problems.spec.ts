import { orderedProblems } from './ordered-problems';

describe('orderedProblems', () => {
  it('sorts by order without touching the stored array', () => {
    const problems = [{ order: 2 }, { order: 0 }, { order: 1 }];
    expect(orderedProblems({ problems })).toEqual([
      { order: 0 },
      { order: 1 },
      { order: 2 },
    ]);
    expect(problems.map((problem) => problem.order)).toEqual([2, 0, 1]);
  });

  it('keeps stored order for equal orders and handles no problems', () => {
    const problems = [
      { order: 1, id: 'a' },
      { order: 1, id: 'b' },
    ];
    expect(orderedProblems({ problems }).map(({ id }) => id)).toEqual([
      'a',
      'b',
    ]);
    expect(orderedProblems({ problems: [] })).toEqual([]);
  });
});
