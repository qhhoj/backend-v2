import { competitionRanks, strictlyAbove } from './ranks';

describe('competitionRanks', () => {
  it('shares a rank among ties and skips after them, like legacy ranker', () => {
    expect(competitionRanks([10, 10, 8, 7, 7, 7, 1], 1)).toEqual([
      1, 1, 3, 4, 4, 4, 7,
    ]);
  });

  it('starts from the given rank', () => {
    expect(competitionRanks([5, 5, 4], 101)).toEqual([101, 101, 103]);
  });

  it('treats null as one value', () => {
    expect(competitionRanks([1500, null, null], 1)).toEqual([1, 2, 2]);
  });

  it('ranks nothing for an empty page', () => {
    expect(competitionRanks([], 1)).toEqual([]);
  });
});

describe('strictlyAbove', () => {
  it('puts every non-null value above null', () => {
    expect(strictlyAbove('rating', null)).toEqual({ rating: { $ne: null } });
    expect(strictlyAbove('rating', 1500)).toEqual({ rating: { $gt: 1500 } });
  });
});
