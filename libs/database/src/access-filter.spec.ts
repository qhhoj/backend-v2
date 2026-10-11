import { narrowTo } from './access-filter';

describe('narrowTo', () => {
  const admits = { authors: 'u1' };

  it('keeps the admitted rows when wanted, the others when not', () => {
    expect(narrowTo(admits, true)).toEqual(admits);
    expect(narrowTo(admits, false)).toEqual({ $nor: [admits] });
  });

  it('a filter admitting nothing keeps no row when wanted and every row when not', () => {
    expect(narrowTo(null, true)).toEqual({ _id: { $in: [] } });
    expect(narrowTo(null, false)).toEqual({});
  });

  it('a filter admitting everything keeps every row when wanted and none when not', () => {
    expect(narrowTo({}, true)).toEqual({});
    expect(narrowTo({}, false)).toEqual({ $nor: [{}] });
  });
});
