import { unique } from './unique';

describe('unique', () => {
  it('drops repeats and keeps the first-seen order', () =>
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']));

  it('returns a new array and leaves an empty input empty', () => {
    const empty: string[] = [];
    expect(unique(empty)).toEqual([]);
    expect(unique(empty)).not.toBe(empty);
  });
});
