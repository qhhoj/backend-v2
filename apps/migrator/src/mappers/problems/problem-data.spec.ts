import { bareName } from './problem-data';

describe('bareName', () => {
  it('strips the legacy <code>/ prefix', () =>
    expect(bareName('sum4/tests.zip', 'sum4')).toBe('tests.zip'));
  it('keeps the last segment of a foreign prefix', () =>
    expect(bareName('other/x/tests.zip', 'sum4')).toBe('tests.zip'));
  it('is null for empty', () => expect(bareName('', 'sum4')).toBeNull());
});
