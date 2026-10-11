import { competitionRanks } from './ranks';

describe('competitionRanks', () => {
  it('shares a rank among ties and skips after them, like legacy ranker', () => {
    expect(competitionRanks([10, 10, 8, 7, 7, 7, 1], 1)).toEqual([
      1, 1, 3, 4, 4, 4, 7,
    ]);
  });

  it('continues from the page offset and treats null as one value', () => {
    expect(competitionRanks([1500, null, null], 101)).toEqual([101, 102, 102]);
  });
});
