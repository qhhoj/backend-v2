import { scoringContextOf } from './scoring-context';
import type { ScoringContestFields } from './scoring-context';

const start = new Date('2026-01-01T10:00:00Z');
const end = new Date('2026-01-01T15:00:00Z');
const contest = (
  extra: Partial<ScoringContestFields> = {},
): ScoringContestFields => ({
  startTime: start,
  endTime: end,
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'default',
  pointsPrecision: 3,
  problems: [{ problem: 'p1', points: 100 }],
  ...extra,
});
const joinedAt = new Date('2026-01-01T11:30:00Z');
const participation = (extra = {}) => ({
  realStart: joinedAt,
  virtual: 0,
  isRegistered: false,
  ...extra,
});

describe('scoringContextOf', () => {
  it('starts a windowed participation at its join time and an unwindowed one at the contest start', () => {
    expect(
      scoringContextOf(contest({ timeLimit: 3600 }), participation(), new Map())
        .start,
    ).toEqual(joinedAt);
    expect(
      scoringContextOf(contest(), participation(), new Map()).start,
    ).toEqual(start);
  });

  it('freezes only formats that freeze, from the end minus the freeze minutes', () => {
    const frozen = scoringContextOf(
      contest({ formatName: 'icpc', frozenLastMinutes: 30 }),
      participation(),
      new Map(),
    );
    expect(frozen.frozenTime).toEqual(new Date('2026-01-01T14:30:00Z'));
    expect(
      scoringContextOf(
        contest({ frozenLastMinutes: 30 }),
        participation(),
        new Map(),
      ).frozenTime,
    ).toBeNull();
  });
});
