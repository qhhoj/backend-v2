import { problemLabel } from './labels';

describe('problemLabel', () => {
  it.each([
    [9, 'numeric', '10'],
    [25, 'alpha', 'Z'],
    [26, 'alpha', 'AA'],
    [51, 'alpha', 'AZ'],
    [701, 'alpha', 'ZZ'],
    [702, 'alpha', 'AAA'],
  ] as const)('labels index %p (%s) as %p', (index, style, label) =>
    expect(problemLabel(index, style)).toBe(label),
  );
});
