import type { Contest, Submission } from '@libs/database';
import { contestBlock } from './submission-contest-block';

const MINUTE_MS = 60_000;
const START = new Date('2026-01-01T10:00:00Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * MINUTE_MS);
const PROBLEM = 'problem-1';

/** A contest of two hours from `START` whose one problem is worth `points`. */
const contestOf = (overrides: Partial<Contest> = {}) =>
  ({
    key: 'round',
    name: 'Round',
    formatName: 'default',
    startTime: START,
    endTime: at(120),
    timeLimit: null,
    problems: [{ problem: PROBLEM, points: 50, partial: true }],
    ...overrides,
  }) as unknown as Contest;

/** A submission with a quarter of its case points, made `minutes` after `START`. */
const submissionAt = (minutes: number) =>
  ({
    problem: PROBLEM,
    date: at(minutes),
    casePoints: 1,
    caseTotal: 4,
  }) as unknown as Submission;

const noRun = { row: undefined, run: undefined, problemPartial: true };

describe('contestBlock', () => {
  it("scores the cases on the contest problem's own points, so each row reads on its contest's scale", () => {
    const worth50 = contestOf();
    const worth200 = contestOf({
      problems: [{ problem: PROBLEM, points: 200, partial: true }],
    } as Partial<Contest>);
    expect(
      contestBlock(submissionAt(10), { contest: worth50, ...noRun }),
    ).toEqual({ key: 'round', name: 'Round', points: 12.5, minute: null });
    expect(
      contestBlock(submissionAt(10), { contest: worth200, ...noRun }).points,
    ).toBe(50);
  });

  it('keeps the stored points of a problem that left the contest, and has none without a row', () => {
    const left = contestOf({ problems: [] });
    const row = { points: 20, participation: 'run-1' };
    expect(
      contestBlock(submissionAt(10), { contest: left, ...noRun, row }).points,
    ).toBe(20);
    expect(
      contestBlock(submissionAt(10), { contest: left, ...noRun }).points,
    ).toBeNull();
  });

  describe('the run minute', () => {
    const live = { virtual: 0, isRegistered: false, realStart: at(30) };
    const virtual = { virtual: 1, isRegistered: false, realStart: at(30) };
    const minuteOf = (
      made: number,
      run: typeof live | undefined,
      overrides: Partial<Contest> = {},
    ) =>
      contestBlock(submissionAt(made), {
        contest: contestOf(overrides),
        ...noRun,
        run,
      }).minute;

    it.each([
      {
        name: 'counts a live run from the contest start, in whole minutes',
        made: 47.5,
        run: live,
        minute: 47,
      },
      {
        name: 'counts a virtual run from its join',
        made: 47.5,
        run: virtual,
        minute: 17,
      },
      {
        name: 'is 0 at the very start of the run',
        made: 30,
        run: virtual,
        minute: 0,
      },
      {
        name: 'is null before the virtual run joined',
        made: 10,
        run: virtual,
        minute: null,
      },
      {
        name: 'is null after the virtual run ended (the contest length from its join)',
        made: 151,
        run: virtual,
        minute: null,
      },
      {
        name: 'is null without a run (another viewer)',
        made: 47.5,
        run: undefined,
        minute: null,
      },
    ])('$name', ({ made, run, minute }) =>
      expect(minuteOf(made, run)).toBe(minute),
    );

    it("counts a time-limited live run from the join, as the scoreboard's participationStart does", () => {
      expect(minuteOf(47.5, live, { timeLimit: 3600 })).toBe(17);
    });
  });
});
