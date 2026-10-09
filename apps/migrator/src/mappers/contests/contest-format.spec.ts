import { camelConfig } from './contest-format';

describe('camelConfig', () => {
  it('camelCases keys', () =>
    expect(
      camelConfig({ last_score_altering: true, cumtime: false }, 'ioi'),
    ).toEqual({ lastScoreAltering: true, cumtime: false }));
  it('drops cumtime for final_submission', () =>
    expect(
      camelConfig({ cumtime: true, auto_judge: false }, 'final_submission'),
    ).toEqual({ autoJudge: false }));
  it('is empty for a non-object', () =>
    expect(camelConfig(null, 'icpc')).toEqual({}));
  it("renames VNOJ's upper-case LSO before camelCasing", () =>
    expect(camelConfig({ penalty: 5, LSO: true }, 'vnoj')).toEqual({
      penalty: 5,
      lso: true,
    }));
});
