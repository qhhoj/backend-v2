import { finalSubmissionFormat } from './final-submission';
import { FormatConfigError } from './format';
import type { FormatName } from './format';
import { batchMinima, dataPoints, ioi16Format } from './ioi16';
import { parseFormatConfig, scoreParticipation } from './registry';
import { at, context, row } from './scoring-fixtures';
import { ultimateFormat } from './ultimate';

describe('ioi16 (legacy IOIContestFormat, "IOI")', () => {
  it('pools cases outside batches under 0 and keeps each batch minimum', () =>
    expect(
      batchMinima([
        { batch: 1, points: 10 },
        { batch: 1, points: 4 },
        { batch: null, points: 2 },
        { batch: null, points: 3 },
        { batch: 2, points: 7 },
      ]),
    ).toEqual({ '0': 2, '1': 4, '2': 7 }));

  it('sums plain cases outside batches and batch starts, ignoring cases inside batches', () =>
    expect(
      dataPoints([
        { type: 'C', points: 5 },
        { type: 'S', points: 10 },
        { type: 'C', points: 99 },
        { type: 'E', points: null },
        { type: 'C', points: 7 },
        { type: 'C', points: null },
      ]),
    ).toBe(22));

  it('takes the best of each batch across submissions, scaled to the contest points', () => {
    const problems = [
      { problemId: 'P', points: 100, dataPoints: 50 },
      { problemId: 'Q', points: 100, dataPoints: 0 },
      { problemId: 'R', points: 100, dataPoints: 50 },
    ];
    const score = ioi16Format.score(
      [
        row('P', 10, 30, { batchPoints: { '1': 10, '2': 0, '0': 5 } }),
        row('P', 20, 50, { batchPoints: { '1': 0, '2': 20, '0': 5 } }),
        row('Q', 5, 0, { batchPoints: { '1': 10 } }),
        row('R', 5, 0, { result: 'CE', status: 'CE' }),
      ],
      { cumtime: false },
      context({ problems }),
    );
    // (10 + 20 + 5) × 100 / 50: better than either submission alone (30, 50).
    expect(score).toMatchObject({ score: 70, cumtime: 0, tiebreaker: 0 });
    expect(score.formatData).toEqual({
      P: { points: 70, time: 0 },
      Q: { points: 0, time: 0 },
      R: { points: 0, time: 0 },
    });
  });
  it('scores zero for no batches, a problem outside the context or without data points, and ignores row order and cumtime', () => {
    const rows = [
      row('P', 20, 0, { batchPoints: { '1': 4, '2': 3 }, submissionId: 'b' }),
      row('P', 10, 0, { batchPoints: { '1': 6 }, submissionId: 'a' }),
      row('X', 5, 0, { batchPoints: { '1': 9 } }),
      row('N', 5, 0, { batchPoints: null }),
    ];
    const problems = [
      { problemId: 'P', points: 30, dataPoints: 10 },
      { problemId: 'N', points: 30, dataPoints: 10 },
    ];
    const forward = ioi16Format.score(
      rows,
      { cumtime: true },
      context({ problems }),
    );
    const reversed = ioi16Format.score(
      [...rows].reverse(),
      { cumtime: false },
      context({ problems }),
    );
    expect(forward).toEqual(reversed);
    expect(forward.score).toBe(27);
    expect(forward.formatData).toEqual({
      P: { points: 27, time: 0 },
      X: { points: 0, time: 0 },
      N: { points: 0, time: 0 },
    });
  });

  it('rounds the total to the points precision, ties to even', () => {
    const problems = [{ problemId: 'P', points: 5, dataPoints: 2 }];
    const score = (precision: number, points: number) =>
      ioi16Format.score(
        [row('P', 1, 0, { batchPoints: { '1': points } })],
        { cumtime: false },
        context({ problems, pointsPrecision: precision }),
      ).score;
    expect(score(0, 1)).toBe(2); // 2.5 -> 2
    expect(score(0, 1.4)).toBe(4); // 3.5 -> 4
  });

  it('hides solve times by default', () =>
    expect(ioi16Format.parseConfig(null)).toEqual({ cumtime: false }));

  it('shows solve times only with cumtime, all of them zero', () => {
    expect(
      ioi16Format.firstSolveTime({ points: 1, time: 0 }, { cumtime: false }),
    ).toBeNull();
    expect(
      ioi16Format.firstSolveTime({ points: 1, time: 0 }, { cumtime: true }),
    ).toBe(0);
    expect(() => ioi16Format.parseConfig({ lastScoreAltering: true })).toThrow(
      FormatConfigError,
    );
  });
});

describe('ultimate (legacy UltimateContestFormat, fixed)', () => {
  it('scores each problem by its last submission, timed from the contest start, with the tiebreaker written and the score rounded', () => {
    const score = ultimateFormat.score(
      [
        row('A', 70, 100),
        row('A', 80, 40),
        row('B', 65, 0),
        row('C', 90, 10, { submissionId: 'z1' }),
        row('C', 90, 100 / 3, { submissionId: 'z2' }),
      ],
      {},
      // A virtual participation that joined an hour after the contest start.
      context({ start: at(60), contestStart: at(0), pointsPrecision: 2 }),
    );
    expect(score).toMatchObject({
      score: 73.33,
      cumtime: 4800 + 5400,
      tiebreaker: 5400,
    });
    expect(score.formatData).toEqual({
      A: { points: 40, time: 4800 },
      B: { points: 0, time: 0 },
      C: { points: 100 / 3, time: 5400 },
    });
  });

  it('lets a later zero or lower submission replace an earlier better one, whatever the row order', () => {
    const rows = [
      row('A', 50, 0),
      row('A', 10, 100),
      row('B', 30, 20),
      row('B', 20, 90),
      row('C', 5, 100),
    ];
    const forward = ultimateFormat.score(rows, {}, context());
    expect(ultimateFormat.score([...rows].reverse(), {}, context())).toEqual(
      forward,
    );
    expect(forward.formatData).toEqual({
      A: { points: 0, time: 0 },
      B: { points: 20, time: 1800 },
      C: { points: 100, time: 300 },
    });
    // A scored 0 last, so its time counts neither in cumtime nor in the tiebreaker.
    expect(forward).toMatchObject({
      score: 120,
      cumtime: 2100,
      tiebreaker: 1800,
    });
  });

  it('keeps fractional seconds, and rounds the score half to even', () => {
    const fractional = row('A', 1, 5, {
      date: new Date(at(1).getTime() + 500),
    });
    const score = ultimateFormat.score(
      [fractional, row('B', 2, 0.5)],
      {},
      context({ pointsPrecision: 0 }),
    );
    expect(score.formatData.A.time).toBe(60.5);
    expect(score).toMatchObject({
      score: 6,
      cumtime: 60.5 + 120,
      tiebreaker: 120,
    });
    expect(
      ultimateFormat.score(
        [row('A', 1, 2.5)],
        {},
        context({ pointsPrecision: 0 }),
      ).score,
    ).toBe(2);
  });

  it('takes the tiebreaker from the latest solve even when an earlier-iterated problem owns it', () =>
    expect(
      ultimateFormat.score(
        [row('A', 5, 0), row('A', 90, 100), row('B', 10, 100)],
        {},
        context(),
      ),
    ).toMatchObject({ cumtime: 6000, tiebreaker: 5400 }));

  it('clamps a negative cumtime to zero', () =>
    expect(
      ultimateFormat.score([row('A', -10, 100)], {}, context()),
    ).toMatchObject({ cumtime: 0, tiebreaker: 0 }));

  it('shows every solve time to first solves', () =>
    expect(ultimateFormat.firstSolveTime({ points: 1, time: 7 }, {})).toBe(7));

  it('accepts only an empty config', () => {
    expect(ultimateFormat.parseConfig({})).toEqual({});
    expect(() => ultimateFormat.parseConfig({ penalty: 1 })).toThrow(
      FormatConfigError,
    );
  });
});

describe('final_submission (legacy FinalSubmissionContestFormat)', () => {
  it('scores each problem by its last judged submission, ignoring pending ones and time', () => {
    const score = finalSubmissionFormat.score(
      [
        row('A', 10, 100),
        row('A', 20, 0),
        row('A', 30, 0, { status: 'PD', result: null }),
        row('B', 15, 0, { status: 'PD', result: null }),
        row('C', 5, 50),
      ],
      { autoJudge: true },
      context(),
    );
    expect(score).toMatchObject({ score: 50, cumtime: 0, tiebreaker: 0 });
    expect(score.formatData).toEqual({
      A: { points: 0, time: 0 },
      C: { points: 50, time: 0 },
    });
  });

  it('takes the last judged submission by date then id, lower or zero included, whatever the row order', () => {
    const rows = [
      row('A', 10, 100),
      row('A', 20, 30, { submissionId: 'x1' }),
      row('A', 20, 10, { submissionId: 'x2' }),
      row('B', 5, 0, { result: 'CE', status: 'CE' }),
      row('B', 1, 100),
      row('P', 5, 100, { status: 'PD', result: null }),
    ];
    const forward = finalSubmissionFormat.score(
      rows,
      { autoJudge: true },
      context(),
    );
    expect(
      finalSubmissionFormat.score(
        [...rows].reverse(),
        { autoJudge: true },
        context(),
      ),
    ).toEqual(forward);
    expect(forward.score).toBe(10);
    expect(forward.formatData).toEqual({
      A: { points: 10, time: 0 },
      B: { points: 0, time: 0 },
    });
  });

  it('scores nothing when every submission is pending, and rounds half to even', () => {
    const pending = row('A', 1, 5, { status: 'PD', result: null });
    expect(
      finalSubmissionFormat.score([pending], { autoJudge: true }, context()),
    ).toMatchObject({ score: 0, formatData: {} });
    expect(
      finalSubmissionFormat.score(
        [row('A', 1, 0.5)],
        { autoJudge: true },
        context({ pointsPrecision: 0 }),
      ).score,
    ).toBe(0);
    expect(
      finalSubmissionFormat.score(
        [row('A', 1, 1.5), row('B', 1, 1)],
        { autoJudge: true },
        context({ pointsPrecision: 0 }),
      ).score,
    ).toBe(2);
  });

  it('scores a submission still queued or running, only pending ones being ignored', () =>
    expect(
      finalSubmissionFormat.score(
        [row('A', 10, 100), row('A', 20, 0, { status: 'QU', result: null })],
        { autoJudge: true },
        context(),
      ),
    ).toMatchObject({ score: 0, formatData: { A: { points: 0 } } }));

  it('judges automatically unless configured not to', () => {
    expect(finalSubmissionFormat.parseConfig(null)).toEqual({
      autoJudge: true,
    });
    expect(finalSubmissionFormat.parseConfig({ autoJudge: false })).toEqual({
      autoJudge: false,
    });
  });
});

describe('registry', () => {
  it('scores through the named format with its parsed config', () => {
    const rows = [row('A', 10, 0), row('A', 20, 100)];
    expect(
      scoreParticipation(
        rows,
        { name: 'icpc', config: { penalty: 10 } },
        context(),
      ),
    ).toMatchObject({ cumtime: 30 });
    expect(
      scoreParticipation(rows, { name: 'icpc', config: null }, context()),
    ).toMatchObject({ cumtime: 40 });
  });

  it('rejects an invalid config for the named format', () => {
    expect(() => parseFormatConfig('default', { penalty: 1 })).toThrow(
      FormatConfigError,
    );
    expect(parseFormatConfig('vnoj', { lso: true })).toEqual({
      penalty: 5,
      lso: true,
    });
    expect(() =>
      scoreParticipation(
        [],
        { name: 'ioi16', config: { cumtime: 1 } },
        context(),
      ),
    ).toThrow(FormatConfigError);
  });

  it.each([
    ['default', 100, 1800, 1800],
    ['ioi', 100, 0, 600],
    ['ioi16', 100, 0, 0],
    ['icpc', 100, 10, 600],
    ['vnoj', 100, 600, 600],
    ['ultimate', 0, 0, 0],
    ['final_submission', 50, 0, 0],
  ] as [FormatName, number, number, number][])(
    'binds %s to its own module (score %d, cumtime %d, cell time %d)',
    (name, score, cumtime, time) => {
      const rows = [
        row('A', 10, 100, { batchPoints: { '1': 10 } }),
        row('A', 20, 50),
        row('A', 30, 0, { status: 'PD', result: null }),
      ];
      const problems = [{ problemId: 'A', points: 100, dataPoints: 10 }];
      const scored = scoreParticipation(
        rows,
        { name, config: null },
        context({ problems }),
      );
      expect(scored).toMatchObject({ score, cumtime });
      expect(scored.formatData).toMatchObject({ A: { time } });
    },
  );
});
