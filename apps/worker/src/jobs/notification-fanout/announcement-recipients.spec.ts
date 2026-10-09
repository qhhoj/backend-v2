import type { ContestTimes, ParticipationTimes } from '@libs/contests';
import { receivesAnnouncement } from './announcement-recipients';

const NOW = new Date('2026-10-09T12:00:00Z');
const minutes = (offset: number) => new Date(NOW.getTime() + offset * 60_000);
const contest = (overrides: Partial<ContestTimes> = {}): ContestTimes => ({
  startTime: minutes(-60),
  endTime: minutes(120),
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'default',
  ...overrides,
});
const row = (
  overrides: Partial<ParticipationTimes> = {},
): ParticipationTimes => ({
  realStart: minutes(-30),
  virtual: 0,
  isRegistered: false,
  ...overrides,
});

describe('receivesAnnouncement', () => {
  it('reaches live participants, registered or joined', () => {
    expect(receivesAnnouncement(contest(), row(), NOW)).toBe(true);
    expect(
      receivesAnnouncement(contest(), row({ isRegistered: true }), NOW),
    ).toBe(true);
  });

  it('skips spectators', () => {
    expect(receivesAnnouncement(contest(), row({ virtual: -1 }), NOW)).toBe(
      false,
    );
  });

  it('reaches a virtual run that is still running', () => {
    expect(
      receivesAnnouncement(
        contest(),
        row({ virtual: 1, realStart: minutes(-10) }),
        NOW,
      ),
    ).toBe(true);
  });

  it('skips a virtual run that ended, by window or by time limit', () => {
    expect(
      receivesAnnouncement(
        contest(),
        row({ virtual: 1, realStart: minutes(-500) }),
        NOW,
      ),
    ).toBe(false);
    expect(
      receivesAnnouncement(
        contest({ timeLimit: 600 }),
        row({ virtual: 2, realStart: minutes(-20) }),
        NOW,
      ),
    ).toBe(false);
  });
});
