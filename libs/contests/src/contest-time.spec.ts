import {
  contestPhase,
  frozenTime,
  hasParticipationEnded,
  isFrozen,
  isRegistrationOpen,
  participationEnd,
  participationStart,
  requiresRegistration,
} from './contest-time';
import type { ContestTimes, ParticipationTimes } from './contest-time';

const hour = 60 * 60 * 1000;
const START = new Date('2026-03-01T08:00:00Z');
const after = (milliseconds: number) =>
  new Date(START.getTime() + milliseconds);
const contest = (extra: Partial<ContestTimes> = {}): ContestTimes => ({
  startTime: START,
  endTime: after(5 * hour),
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'default',
  ...extra,
});
const participation = (
  extra: Partial<ParticipationTimes> = {},
): ParticipationTimes => ({
  realStart: after(hour),
  virtual: 0,
  isRegistered: false,
  ...extra,
});

describe('contestPhase (legacy can_join / ended)', () => {
  it.each([
    [after(-1), 'upcoming'],
    [START, 'running'],
    [after(5 * hour), 'running'],
    [after(5 * hour + 1), 'ended'],
  ])('at %p is %p', (now, phase) =>
    expect(contestPhase(contest(), now)).toBe(phase),
  );
});

describe('participation window (legacy start / end_time)', () => {
  it.each([
    {
      name: 'live, no time limit: the contest window',
      times: contest(),
      joined: participation(),
      start: START,
      end: after(5 * hour),
    },
    {
      name: 'live with a time limit: from joining, cut at the contest end',
      times: contest({ timeLimit: 2 * 3600 }),
      joined: participation(),
      start: after(hour),
      end: after(3 * hour),
    },
    {
      name: 'live joining late with a time limit: still ends with the contest',
      times: contest({ timeLimit: 2 * 3600 }),
      joined: participation({ realStart: after(4 * hour) }),
      start: after(4 * hour),
      end: after(5 * hour),
    },
    {
      name: 'registered, not joined: the contest window',
      times: contest({ timeLimit: 3600 }),
      joined: participation({ isRegistered: true, realStart: new Date(0) }),
      start: START,
      end: after(5 * hour),
    },
    {
      name: 'spectating, no time limit: the contest window',
      times: contest(),
      joined: participation({ virtual: -1 }),
      start: START,
      end: after(5 * hour),
    },
    {
      name: 'spectating: the contest window',
      times: contest({ timeLimit: 3600 }),
      joined: participation({ virtual: -1 }),
      start: after(hour),
      end: after(5 * hour),
    },
    {
      name: 'virtual without a time limit: the contest length from joining',
      times: contest(),
      joined: participation({ virtual: 2, realStart: after(10 * hour) }),
      start: after(10 * hour),
      end: after(15 * hour),
    },
    {
      name: 'virtual with a time limit: the limit from joining',
      times: contest({ timeLimit: 1800 }),
      joined: participation({ virtual: 1, realStart: after(10 * hour) }),
      start: after(10 * hour),
      end: after(10.5 * hour),
    },
  ])('$name', ({ times, joined, start, end }) => {
    expect(participationStart(times, joined)).toEqual(start);
    expect(participationEnd(times, joined)).toEqual(end);
  });

  it('ends strictly after the end time', () => {
    expect(
      hasParticipationEnded(contest(), participation(), after(5 * hour)),
    ).toBe(false);
    expect(
      hasParticipationEnded(contest(), participation(), after(5 * hour + 1)),
    ).toBe(true);
  });
});

describe('freeze (legacy is_frozen)', () => {
  it('freezes icpc and vnoj for their last minutes and stays frozen after the end', () => {
    for (const formatName of ['icpc', 'vnoj'] as const) {
      const frozen = contest({ formatName, frozenLastMinutes: 60 });
      expect(frozenTime(frozen)).toEqual(after(4 * hour));
      expect(isFrozen(frozen, after(4 * hour - 1))).toBe(false);
      expect(isFrozen(frozen, after(4 * hour))).toBe(true);
      expect(isFrozen(frozen, after(50 * hour))).toBe(true);
    }
  });

  it('never freezes other formats or a zero freeze', () => {
    expect(
      frozenTime(contest({ formatName: 'ioi', frozenLastMinutes: 60 })),
    ).toBeNull();
    expect(
      frozenTime(contest({ formatName: 'icpc', frozenLastMinutes: 0 })),
    ).toBeNull();
    expect(
      isFrozen(
        contest({ formatName: 'default', frozenLastMinutes: 60 }),
        after(5 * hour),
      ),
    ).toBe(false);
  });
});

describe('registration (legacy require_registration / can_register)', () => {
  const window = (
    registrationStart: Date | null,
    registrationEnd: Date | null,
  ) => ({ registrationStart, registrationEnd });
  it('is required as soon as either bound is set', () => {
    expect(requiresRegistration(window(null, null))).toBe(false);
    expect(requiresRegistration(window(null, after(-hour)))).toBe(true);
    expect(requiresRegistration(window(after(-2 * hour), null))).toBe(true);
  });
  it.each([
    [window(null, null), START, false],
    [window(after(-2 * hour), after(-hour)), after(-1.5 * hour), true],
    [window(after(-2 * hour), after(-hour)), after(-2 * hour - 1), false],
    [window(after(-2 * hour), after(-hour)), after(-hour + 1), false],
    [window(after(-2 * hour), after(-hour)), after(-2 * hour), true],
    [window(after(-2 * hour), after(-hour)), after(-hour), true],
    [window(null, after(-hour)), after(-10 * hour), true],
    [window(after(-2 * hour), null), after(4 * hour), true],
  ])('is open for %p at %p: %p', (bounds, now, open) =>
    expect(isRegistrationOpen(bounds, now)).toBe(open),
  );
});
