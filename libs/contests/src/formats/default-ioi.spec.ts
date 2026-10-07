import { defaultFormat } from './default';
import { FormatConfigError } from './format';
import { ioiFormat } from './ioi';
import { context, row } from './scoring-fixtures';

/**
 * A: 50 at +10m, 100 at +20m, 30 at +30m (worse but latest).
 * B: 0 at +5m.
 * C: 10 at -10m (before the participation start).
 */
const rows = () => [
  row('A', 10, 50),
  row('A', 20, 100),
  row('A', 30, 30),
  row('B', 5, 0),
  row('C', -10, 10),
];

describe('default (legacy DefaultContestFormat)', () => {
  it('times each problem by its latest submission, best points, cumtime over scored problems clamped at 0', () => {
    expect(defaultFormat.score(rows(), {}, context())).toEqual({
      score: 110,
      // A: 1800 (latest, not the best's 1200) + C: -600; B scores nothing.
      cumtime: 1200,
      tiebreaker: 0,
      formatData: {
        A: { time: 1800, points: 100 },
        B: { time: 300, points: 0 },
        C: { time: -600, points: 10 },
      },
      frozenScore: 110,
      frozenCumtime: 1200,
      frozenTiebreaker: 0,
      frozenFormatData: {
        A: { time: 1800, points: 100 },
        B: { time: 300, points: 0 },
        C: { time: -600, points: 10 },
      },
    });
  });

  it('clamps a negative cumtime to 0', () =>
    expect(
      defaultFormat.score([row('C', -10, 10)], {}, context()).cumtime,
    ).toBe(0));

  it.each([
    [3, 66.667],
    [2, 66.67],
    [0, 67],
  ])('rounds the score to %p digits', (pointsPrecision, score) =>
    expect(
      defaultFormat.score(
        [row('A', 1, 100 / 3), row('B', 1, 100 / 3)],
        {},
        context({ pointsPrecision }),
      ).score,
    ).toBe(score),
  );

  it('scores no rows as zero', () =>
    expect(defaultFormat.score([], {}, context())).toMatchObject({
      score: 0,
      cumtime: 0,
      formatData: {},
    }));

  it.each([null, undefined, {}])('accepts the config %p', (config) =>
    expect(defaultFormat.parseConfig(config)).toEqual({}),
  );
  it.each([{ penalty: 20 }, [], 'x'])('rejects the config %p', (config) =>
    expect(() => defaultFormat.parseConfig(config)).toThrow(FormatConfigError),
  );

  it('offers the cell time for first solves', () =>
    expect(defaultFormat.firstSolveTime({ time: 42, points: 1 }, {})).toBe(42));
});

describe('ioi (legacy LegacyIOIContestFormat, "IOI (pre-2016)")', () => {
  it.each([
    // Best points per problem, timed at the first submission reaching them (A: +20m, not +30m).
    [{ cumtime: false, lastScoreAltering: false }, 0, 0],
    [{ cumtime: true, lastScoreAltering: false }, 600, 0],
    // Without cumtime, legacy puts the last score-altering time in cumtime too.
    [{ cumtime: false, lastScoreAltering: true }, 1200, 1200],
    [{ cumtime: true, lastScoreAltering: true }, 600, 1200],
  ])('with %p: cumtime %p, tiebreaker %p', (config, cumtime, tiebreaker) => {
    const score = ioiFormat.score(rows(), config, context());
    expect(score).toMatchObject({ score: 110, cumtime, tiebreaker });
    expect(score.formatData).toEqual({
      A: { points: 100, time: 1200 },
      B: { points: 0, time: 0 },
      C: { points: 10, time: -600 },
    });
  });

  it('fills defaults and validates keys and types', () => {
    expect(ioiFormat.parseConfig(null)).toEqual({
      cumtime: false,
      lastScoreAltering: false,
    });
    expect(ioiFormat.parseConfig({ cumtime: true })).toEqual({
      cumtime: true,
      lastScoreAltering: false,
    });
    expect(() => ioiFormat.parseConfig({ cumtime: 'yes' })).toThrow(
      'invalid type for config key "cumtime"',
    );
    expect(() => ioiFormat.parseConfig({ penalty: 1 })).toThrow(
      'unknown config key "penalty"',
    );
  });

  it('shows solve times only with cumtime or last score altering', () => {
    const cell = { points: 100, time: 1200 };
    expect(
      ioiFormat.firstSolveTime(cell, {
        cumtime: false,
        lastScoreAltering: false,
      }),
    ).toBeNull();
    expect(
      ioiFormat.firstSolveTime(cell, {
        cumtime: false,
        lastScoreAltering: true,
      }),
    ).toBe(1200);
  });
});
