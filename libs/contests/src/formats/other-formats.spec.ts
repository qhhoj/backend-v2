import { finalSubmissionFormat } from './final-submission';
import { FormatConfigError } from './format';
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

  it('takes the tiebreaker from the latest solve even when an earlier-iterated problem owns it', () =>
    expect(
      ultimateFormat.score(
        [row('A', 5, 0), row('A', 90, 100), row('B', 10, 100)],
        {},
        context(),
      ),
    ).toMatchObject({ cumtime: 6000, tiebreaker: 5400 }));
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

  it('scores a submission still queued or running, only pending ones being ignored', () =>
    expect(
      finalSubmissionFormat.score(
        [row('A', 10, 100), row('A', 20, 0, { status: 'QU', result: null })],
        { autoJudge: true },
        context(),
      ),
    ).toMatchObject({ score: 0, formatData: { A: { points: 0 } } }));
});

describe('registry', () => {
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
});
