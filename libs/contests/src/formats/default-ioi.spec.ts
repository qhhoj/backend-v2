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

  it('scores rows the same whatever order they arrive in', () =>
    expect(defaultFormat.score(rows().reverse(), {}, context())).toEqual(
      defaultFormat.score(rows(), {}, context()),
    ));

  it('clamps a negative cumtime to 0', () =>
    expect(
      defaultFormat.score([row('C', -10, 10)], {}, context()).cumtime,
    ).toBe(0));

  it.each([
    [2.5, 0, 2],
    [0.125, 2, 0.12],
  ])(
    'rounds the tie %p at %p digits half to even',
    (points, pointsPrecision, score) =>
      expect(
        defaultFormat.score(
          [row('A', 1, points)],
          {},
          context({ pointsPrecision }),
        ).score,
      ).toBe(score),
  );

  it.each([
    [3, 66.667],
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

  it.each([{ penalty: 20 }, 'x'])('rejects the config %p', (config) =>
    expect(() => defaultFormat.parseConfig(config)).toThrow(FormatConfigError),
  );
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

  it('times a problem at its earliest best and the tiebreaker at the latest of those times', () => {
    const score = ioiFormat.score(
      [
        row('A', 10, 50),
        row('A', 50, 100),
        row('A', 60, 100),
        row('D', 12, 40),
      ],
      { cumtime: false, lastScoreAltering: true },
      context(),
    );
    expect(score.formatData).toEqual({
      A: { points: 100, time: 3000 },
      D: { points: 40, time: 720 },
    });
    expect(score.tiebreaker).toBe(3000);
  });

  it('rejects inherited keys as unknown', () => {
    expect(() =>
      ioiFormat.parseConfig(JSON.parse('{"__proto__": {}}')),
    ).toThrow(FormatConfigError);
    expect(() => ioiFormat.parseConfig({ toString: 1 })).toThrow(
      'unknown config key "toString"',
    );
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
});
