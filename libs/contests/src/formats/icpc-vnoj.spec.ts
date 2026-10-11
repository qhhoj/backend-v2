import { FormatConfigError } from './format';
import type { ScoringRow } from './format';
import { icpcFormat } from './icpc';
import { at, context, row } from './scoring-fixtures';
import { vnojFormat } from './vnoj';

/** Contest of 300 minutes frozen for the last 60: rows from +240m on are frozen. */
const frozenContext = (extra = {}) =>
  context({ frozenTime: at(240), ...extra });

/** Every order the rows can arrive in must give the same score. */
const orders = (rows: ScoringRow[]): ScoringRow[][] => {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = (index * 7 + 3) % (index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return [rows, [...rows].reverse(), shuffled];
};

describe('icpc (legacy ICPCContestFormat)', () => {
  /**
   * A: WA +10m, CE +15m (not a try), AC +25m30s, WA +40m (after the AC, not counted).
   * B: WA +100m, AC +250m (during the freeze).
   * C: WA +100m, WA +260m (no points; its latest try is frozen).
   * D: IE +50m (no try at all).
   */
  const rows = () => [
    row('A', 10, 0),
    row('A', 15, 0, { result: 'CE', status: 'CE' }),
    { ...row('A', 25, 100), date: at(25, 30) },
    row('A', 40, 0),
    row('B', 100, 0),
    row('B', 250, 100),
    row('C', 100, 0),
    row('C', 260, 0),
    row('D', 50, 0, { result: 'IE', status: 'IE' }),
  ];

  it('scores minutes plus 20 per earlier try, ties on the last solve, and freezes what came after the freeze', () => {
    expect(icpcFormat.score(rows(), { penalty: 20 }, frozenContext())).toEqual({
      score: 200,
      // 25 + 250 minutes (seconds floored) + (2 - 1) * 20 for A and for B.
      cumtime: 315,
      tiebreaker: 250,
      frozenScore: 100,
      frozenCumtime: 45,
      frozenTiebreaker: 25,
      formatData: {
        A: { time: 1530, points: 100, tries: 2 },
        B: { time: 15000, points: 100, tries: 2 },
        C: { time: 6000, points: 0, tries: 2 },
        D: { time: 3000, points: 0, tries: 0 },
      },
      frozenFormatData: {
        A: { time: 1530, points: 100, tries: 2, pending: false },
        B: { time: null, points: 0, tries: 2, pending: true },
        C: { time: null, points: 0, tries: 2, pending: true },
        D: { time: null, points: 0, tries: 0, pending: false },
      },
    });
  });

  it('scores rows the same whatever order they arrive in', () => {
    const [expected, ...others] = orders(rows()).map((ordered) =>
      icpcFormat.score(ordered, { penalty: 20 }, frozenContext()),
    );
    for (const other of others) expect(other).toEqual(expected);
  });

  it('without a penalty counts no tries and freezes by the best submission only', () => {
    const score = icpcFormat.score(rows(), { penalty: 0 }, frozenContext());
    expect(score).toMatchObject({
      cumtime: 275,
      frozenCumtime: 25,
      tiebreaker: 250,
    });
    expect(score.formatData.A).toEqual({ time: 1530, points: 100, tries: 0 });
    // C's best is at +100m: not frozen when tries are not counted.
    expect(score.frozenFormatData.C).toEqual({
      time: null,
      points: 0,
      tries: 0,
      pending: false,
    });
  });

  describe('time rules', () => {
    it('times a problem at its first best and counts only the tries up to it', () => {
      const score = icpcFormat.score(
        [row('A', 10, 0), row('A', 20, 100), row('A', 30, 100), row('A', 5, 0)],
        { penalty: 20 },
        context(),
      );
      expect(score.formatData.A).toEqual({ time: 1200, points: 100, tries: 3 });
      // 20 minutes + 2 earlier tries * 20.
      expect(score.cumtime).toBe(60);
    });

    it('counts a try at the very instant of the best as before it', () => {
      const score = icpcFormat.score(
        [row('A', 10, 0), row('A', 10, 100)],
        { penalty: 20 },
        context(),
      );
      expect(score).toMatchObject({ cumtime: 30, tiebreaker: 10 });
    });

    it('breaks ties on the last solve across problems', () => {
      const score = icpcFormat.score(
        [row('A', 90, 100), row('B', 10, 100), row('C', 30, 100)],
        { penalty: 20 },
        context(),
      );
      expect(score).toMatchObject({ tiebreaker: 90, cumtime: 130 });
    });

    it('takes the tiebreaker from the latest solve, not the last problem iterated', () => {
      const lateSolveFirst = [
        row('A', 5, 0),
        row('A', 90, 100),
        row('B', 10, 100),
      ];
      expect(
        icpcFormat.score(lateSolveFirst, { penalty: 20 }, frozenContext()),
      ).toMatchObject({ cumtime: 120, tiebreaker: 90, frozenTiebreaker: 90 });
    });

    it('floors a negative non-whole minute downwards', () =>
      // -9m59s floors to -10 (truncating gives -9): -10 + 30.
      expect(
        icpcFormat.score(
          [{ ...row('A', 0, 100), date: at(-10, 1) }, row('B', 30, 100)],
          { penalty: 20 },
          context(),
        ).cumtime,
      ).toBe(20));

    it('does not count rows without a result as tries', () => {
      const score = icpcFormat.score(
        [row('A', 10, 0, { result: null, status: 'P' }), row('A', 20, 100)],
        { penalty: 20 },
        context(),
      );
      expect(score.formatData.A).toMatchObject({ tries: 1 });
      expect(score.cumtime).toBe(20);
    });
  });

  describe('freeze boundary', () => {
    const solvedAt = (minutes: number, seconds = 0) => [
      { ...row('A', 0, 100), date: at(minutes, seconds) },
    ];

    it('keeps a solve one second before the freeze', () =>
      expect(
        icpcFormat.score(solvedAt(239, 59), { penalty: 20 }, frozenContext()),
      ).toMatchObject({
        frozenScore: 100,
        frozenFormatData: { A: { pending: false, points: 100 } },
      }));

    it('freezes a solve exactly at the freeze instant', () =>
      expect(
        icpcFormat.score(solvedAt(240), { penalty: 20 }, frozenContext()),
      ).toMatchObject({
        score: 100,
        frozenScore: 0,
        frozenCumtime: 0,
        frozenTiebreaker: 0,
        frozenFormatData: { A: { pending: true, points: 0, time: null } },
      }));

    it('freezes an unsolved problem by its latest try, exactly at the freeze instant', () => {
      const frozen = (minutes: number) =>
        icpcFormat.score(
          [row('A', 10, 0), row('A', minutes, 0)],
          { penalty: 20 },
          frozenContext(),
        ).frozenFormatData.A;
      expect(frozen(239)).toMatchObject({ pending: false, tries: 2 });
      expect(frozen(240)).toMatchObject({ pending: true, tries: 2 });
    });
  });

  it.each([
    [2.5, 0, 2],
    [0.125, 2, 0.12],
  ])(
    'rounds the tie %p at %p digits half to even, live and frozen',
    (points, pointsPrecision, score) =>
      expect(
        icpcFormat.score(
          [row('A', 1, points)],
          { penalty: 20 },
          frozenContext({ pointsPrecision }),
        ),
      ).toMatchObject({ score, frozenScore: score }),
  );

  it('clamps a negative cumtime to 0', () =>
    expect(
      icpcFormat.score([row('A', -10, 100)], { penalty: 20 }, context()),
    ).toMatchObject({ cumtime: 0, frozenCumtime: 0 }));

  it.each([
    { penalty: -1 },
    { penalty: '20' },
    JSON.parse('{"__proto__": {}}'),
  ])('rejects the config %p', (config) =>
    expect(() => icpcFormat.parseConfig(config)).toThrow(FormatConfigError),
  );
});

describe('vnoj (legacy VNOJContestFormat)', () => {
  /**
   * A: WA +10m, AC +25m30s, WA +40m.
   * B: WA +100m, AC +250m (during the freeze).
   * C: WA +260m only (nothing before the freeze).
   */
  const rows = () => [
    row('A', 10, 0),
    { ...row('A', 25, 100), date: at(25, 30) },
    row('A', 40, 0),
    row('B', 100, 0),
    row('B', 250, 100),
    row('C', 260, 0),
  ];
  const config = { penalty: 5, lso: false };

  it('scores seconds plus penalty minutes in seconds, counts pending tries, and recomputes the board before the freeze', () => {
    expect(vnojFormat.score(rows(), config, frozenContext())).toEqual({
      score: 200,
      // 1530 + 15000 seconds + one earlier try each on A and B at 5 minutes.
      cumtime: 17130,
      tiebreaker: 15000,
      frozenScore: 100,
      frozenCumtime: 1830,
      frozenTiebreaker: 1530,
      formatData: {
        A: { time: 1530, points: 100, penalty: 1, pending: 0 },
        B: { time: 15000, points: 100, penalty: 1, pending: 1 },
        C: { time: 15600, points: 0, penalty: 1, pending: 1 },
      },
      frozenFormatData: {
        A: { time: 1530, points: 100, penalty: 1, pending: 0 },
        B: { time: 6000, points: 0, penalty: 1, pending: 1 },
        C: { time: 0, points: 0, penalty: 0, pending: 1 },
      },
    });
  });

  it('with last-submission-only times by the last solve instead of the sum', () =>
    expect(
      vnojFormat.score(rows(), { penalty: 5, lso: true }, frozenContext()),
    ).toMatchObject({ cumtime: 15600, frozenCumtime: 1830 }));

  it('without a freeze has no pending counts and mirrors the live fields', () => {
    const score = vnojFormat.score(rows(), config, context());
    expect(score.formatData.B).toEqual({
      time: 15000,
      points: 100,
      penalty: 1,
    });
    expect(score).toMatchObject({ frozenScore: 200, frozenCumtime: 17130 });
    expect(score.frozenFormatData).toEqual(score.formatData);
  });

  describe('time rules', () => {
    it('times a problem at its first best and charges only the tries up to it', () => {
      const score = vnojFormat.score(
        [row('A', 10, 0), row('A', 20, 100), row('A', 30, 100), row('A', 5, 0)],
        config,
        context(),
      );
      expect(score.formatData.A).toEqual({
        time: 1200,
        points: 100,
        penalty: 2,
      });
      expect(score.cumtime).toBe(1200 + 2 * 300);
    });

    it('counts a try at the very instant of the best as before it', () =>
      expect(
        vnojFormat.score(
          [row('A', 10, 0), row('A', 10, 100)],
          config,
          context(),
        ),
      ).toMatchObject({ cumtime: 600 + 300 }));

    it('does not count CE, IE or rows without a result as tries', () => {
      const score = vnojFormat.score(
        [
          row('A', 1, 0, { result: 'CE', status: 'CE' }),
          row('A', 2, 0, { result: 'IE', status: 'IE' }),
          row('A', 3, 0, { result: null, status: 'P' }),
          row('A', 20, 100),
        ],
        config,
        context(),
      );
      expect(score.formatData.A).toMatchObject({ penalty: 0 });
      expect(score.cumtime).toBe(1200);
    });

    it('breaks ties on the last solve and adds it once under lso', () => {
      const solved = [row('A', 10, 100), row('B', 30, 100), row('C', 20, 0)];
      expect(vnojFormat.score(solved, config, context())).toMatchObject({
        cumtime: 2400,
        tiebreaker: 1800,
      });
      expect(
        vnojFormat.score(solved, { penalty: 5, lso: true }, context()),
      ).toMatchObject({ cumtime: 1800, tiebreaker: 1800 });
    });

    it('clamps a negative cumtime to 0, live and frozen', () =>
      expect(
        vnojFormat.score([row('A', -10, 100)], config, frozenContext()),
      ).toMatchObject({ cumtime: 0, frozenCumtime: 0 }));

    it('takes the tiebreaker from the latest solve, not the last problem iterated', () => {
      const lateSolveFirst = [
        row('A', 5, 0),
        row('A', 90, 100),
        row('B', 10, 100),
      ];
      expect(
        vnojFormat.score(lateSolveFirst, config, frozenContext()),
      ).toMatchObject({
        cumtime: 6300,
        tiebreaker: 5400,
        frozenTiebreaker: 5400,
      });
      expect(
        vnojFormat.score(
          lateSolveFirst,
          { penalty: 5, lso: true },
          frozenContext(),
        ).cumtime,
      ).toBe(5700);
    });
  });

  describe('freeze boundary', () => {
    /** A: solved at +230m, then a WA exactly at `minutes`. */
    const withTryAt = (minutes: number) =>
      vnojFormat.score(
        [row('A', 230, 100), row('A', minutes, 0)],
        config,
        frozenContext(),
      );

    it('counts a try exactly at the freeze instant as pending, outside the frozen board', () => {
      const score = withTryAt(240);
      expect(score.formatData.A).toMatchObject({ pending: 1 });
      expect(score.frozenFormatData.A).toEqual({
        time: 13800,
        points: 100,
        penalty: 0,
        pending: 1,
      });
    });

    it('keeps a solve one second before the freeze and drops one exactly at it', () => {
      const solve = (seconds: number) =>
        vnojFormat.score(
          [{ ...row('A', 0, 100), date: at(239, seconds) }],
          config,
          frozenContext(),
        );
      expect(solve(59)).toMatchObject({ frozenScore: 100 });
      const atFreeze = vnojFormat.score(
        [row('A', 240, 100)],
        config,
        frozenContext(),
      );
      expect(atFreeze).toMatchObject({
        score: 100,
        frozenScore: 0,
        frozenCumtime: 0,
      });
      expect(atFreeze.frozenFormatData.A).toEqual({
        time: 0,
        points: 0,
        penalty: 0,
        pending: 1,
      });
    });
  });

  it('defaults to a 5 minute penalty without LSO and validates keys', () => {
    expect(vnojFormat.parseConfig(null)).toEqual({ penalty: 5, lso: false });
    expect(() => vnojFormat.parseConfig({ LSO: true })).toThrow(
      'unknown config key "LSO"',
    );
    expect(() => vnojFormat.parseConfig({ penalty: -1 })).toThrow(
      FormatConfigError,
    );
    expect(() => vnojFormat.parseConfig({ lso: 1 })).toThrow(FormatConfigError);
    expect(() => vnojFormat.parseConfig({ toString: 1 })).toThrow(
      FormatConfigError,
    );
  });
});
