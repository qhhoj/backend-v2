import type { ContestAccessView } from '../../contests/core/contest-access';
import { isContestOpenForShares } from './share-contest-rule';

const NOW = new Date('2026-11-14T12:00:00Z');
const hours = (count: number) => new Date(NOW.getTime() + count * 3_600_000);

const contest = (
  overrides: Partial<ContestAccessView> = {},
): ContestAccessView => ({
  isVisible: true,
  isPrivate: false,
  isOrganizationPrivate: false,
  organizations: [],
  privateContestants: [],
  authors: [],
  curators: [],
  testers: [],
  viewContestScoreboard: [],
  balloonStaff: [],
  scoreboardVisibility: 'V',
  showSubmissionList: false,
  startTime: hours(-5),
  endTime: hours(-2),
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'icpc',
  ...overrides,
});

describe('isContestOpenForShares', () => {
  it.each([
    ['upcoming', { startTime: hours(1), endTime: hours(3) }, false],
    ['running', { startTime: hours(-1), endTime: hours(1) }, false],
    [
      'running with its submission list opened early',
      { startTime: hours(-1), endTime: hours(1), showSubmissionList: true },
      false,
    ],
    ['ended with the board still frozen', { frozenLastMinutes: 60 }, false],
    ['ended with a hidden board', { scoreboardVisibility: 'H' }, false],
    ['ended and open', {}, true],
  ] as const)('%s: %s', (_case, overrides, isOpen) => {
    expect(
      isContestOpenForShares(
        contest(overrides as Partial<ContestAccessView>),
        NOW,
      ),
    ).toBe(isOpen);
  });
});
