import { isLabelShaped, problemLabel } from './labels';

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

describe('isLabelShaped', () => {
  it.each([
    ['C', 'alpha', true],
    ['AB', 'alpha', true],
    ['c', 'alpha', false],
    ['Input', 'alpha', false],
    ['3', 'alpha', false],
    ['12', 'numeric', true],
    ['0', 'numeric', false],
    ['C', 'numeric', false],
  ] as const)('%p in %s style: %p', (text, style, shaped) =>
    expect(isLabelShaped(text, style)).toBe(shaped),
  );
});
