import {
  ORG,
  OTHER,
  PRINCIPALS,
  USER,
  NOW,
  hours,
  principalWith,
  view,
} from '../../../../test/contest-access-fixtures';
import { ContestAccess, NO_FACTS } from './contest-access';

describe('ContestAccess.canSee (legacy access_check)', () => {
  it.each([
    [
      'anonymous never sees a hidden one',
      'anonymous',
      view({ isVisible: false }),
      false,
    ],
    [
      'anonymous never sees a private one',
      'anonymous',
      view({ isPrivate: true, privateContestants: [USER] }),
      false,
    ],
    [
      'see_private_contest sees a hidden one',
      'seePrivate',
      view({ isVisible: false }),
      true,
    ],
    [
      'an author sees a hidden one',
      'plain',
      view({ isVisible: false, authors: [USER] }),
      true,
    ],
    [
      'a listed contestant sees a private one',
      'plain',
      view({ isPrivate: true, privateContestants: [USER] }),
      true,
    ],
    [
      'an unlisted user does not',
      'plain',
      view({ isPrivate: true, privateContestants: [OTHER] }),
      false,
    ],
    [
      'a member sees an organisation-private one',
      'member',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      true,
    ],
    [
      'both: a member must also be listed',
      'member',
      view({
        isPrivate: true,
        isOrganizationPrivate: true,
        organizations: [ORG],
        privateContestants: [OTHER],
      }),
      false,
    ],
    [
      'a scoreboard viewer sees a private one',
      'plain',
      view({ isPrivate: true, viewContestScoreboard: [USER] }),
      true,
    ],
    [
      'but not a hidden one',
      'plain',
      view({ isVisible: false, viewContestScoreboard: [USER] }),
      false,
    ],
  ])('%s', (_case, who, contest, expected) =>
    expect(ContestAccess.canSee(PRINCIPALS[who], contest)).toBe(expected),
  );
});

describe('ContestAccess.canViewBalloons', () => {
  const editorView = view({ authors: [USER] });
  it.each([
    [
      'an editor with the edit permission',
      principalWith({}, 'judge.edit_own_contest'),
      editorView,
      true,
    ],
    [
      'a listed volunteer who is not an editor',
      principalWith(),
      view({ balloonStaff: [USER] }),
      true,
    ],
    [
      'an author without the edit permission',
      principalWith(),
      editorView,
      false,
    ],
  ])('%s', (_who, principal, contestView, expected) =>
    expect(ContestAccess.canViewBalloons(principal, contestView)).toBe(
      expected,
    ),
  );

  it('lets a listed volunteer see a visible private contest, as it does for scoreboard viewers', () => {
    const privateView = view({ isPrivate: true, balloonStaff: [USER] });
    expect(ContestAccess.canSee(principalWith(), privateView)).toBe(true);
    expect(
      ContestAccess.canSee(principalWith(), view({ isPrivate: true })),
    ).toBe(false);
    expect(
      ContestAccess.canSee(
        principalWith(),
        view({ isVisible: false, isPrivate: true, balloonStaff: [USER] }),
      ),
    ).toBe(false);
  });
});

describe('ContestAccess.canEdit (legacy is_editable_by)', () => {
  it.each([
    ['edit_all_contest edits any', 'editAll', view(), true],
    [
      'an author with edit_own_contest edits',
      'editOwn',
      view({ authors: [USER] }),
      true,
    ],
    [
      'a curator with edit_own_contest edits',
      'editOwn',
      view({ curators: [USER] }),
      true,
    ],
    [
      'an author without edit_own_contest does not',
      'plain',
      view({ authors: [USER] }),
      false,
    ],
    [
      'a tester with edit_own_contest does not',
      'editOwn',
      view({ testers: [USER] }),
      false,
    ],
    ['a superuser edits any', 'superuser', view(), true],
    ['anonymous never edits', 'anonymous', view(), false],
  ])('%s', (_case, who, contest, expected) =>
    expect(ContestAccess.canEdit(PRINCIPALS[who], contest)).toBe(expected),
  );
});

describe('scoreboards (legacy show_scoreboard, can_see_*_scoreboard)', () => {
  const inContest = { inContest: true, completedLive: false };
  const completed = { inContest: false, completedLive: true };
  const upcoming = { startTime: hours(1), endTime: hours(3) };
  it.each([
    {
      name: 'V running: anyone, anonymous included',
      who: 'anonymous',
      contest: view(),
      facts: NO_FACTS,
      full: true,
      own: true,
    },
    {
      name: 'V upcoming: nobody but staff',
      who: 'plain',
      contest: view(upcoming),
      facts: inContest,
      full: false,
      own: false,
    },
    {
      name: 'H: a plain user sees only their own row while in it',
      who: 'plain',
      contest: view({ scoreboardVisibility: 'H' }),
      facts: inContest,
      full: false,
      own: true,
    },
    {
      name: 'H: an author sees everything',
      who: 'plain',
      contest: view({ scoreboardVisibility: 'H', authors: [USER] }),
      facts: NO_FACTS,
      full: true,
      own: true,
    },
    {
      name: 'C running: only their own row',
      who: 'plain',
      contest: view({ scoreboardVisibility: 'C' }),
      facts: inContest,
      full: false,
      own: true,
    },
    {
      name: 'P running: everything once their live participation ended',
      who: 'plain',
      contest: view({ scoreboardVisibility: 'P' }),
      facts: completed,
      full: true,
      own: true,
    },
    {
      name: 'P running: anonymous sees nothing',
      who: 'anonymous',
      contest: view({ scoreboardVisibility: 'P' }),
      facts: NO_FACTS,
      full: false,
      own: false,
    },
    {
      name: 'H: a tester sees no more than a contestant',
      who: 'plain',
      contest: view({ scoreboardVisibility: 'H', testers: [USER] }),
      facts: NO_FACTS,
      full: false,
      own: false,
    },
    {
      name: 'C running: a finished participant still sees only their row',
      who: 'plain',
      contest: view({ scoreboardVisibility: 'C' }),
      facts: completed,
      full: false,
      own: true,
    },
  ])('$name', ({ who, contest, facts, full, own }) => {
    expect(
      ContestAccess.canSeeFullScoreboard(PRINCIPALS[who], contest, NOW, facts),
    ).toBe(full);
    expect(
      ContestAccess.canSeeOwnScoreboard(PRINCIPALS[who], contest, NOW, facts),
    ).toBe(own);
  });
});

describe('ContestAccess.canSeeFullSubmissionList (legacy can_see_full_submission_list)', () => {
  const frozen = { formatName: 'icpc' as const, frozenLastMinutes: 180 };
  it.each([
    ['running, list not shown: no', 'plain', view(), false],
    [
      'running, list shown: yes',
      'plain',
      view({ showSubmissionList: true }),
      true,
    ],
    [
      'ended: yes',
      'plain',
      view({ startTime: hours(-5), endTime: hours(-1) }),
      true,
    ],
    [
      'frozen, even shown: no',
      'plain',
      view({ ...frozen, showSubmissionList: true }),
      false,
    ],
    [
      'frozen: an author yes',
      'plain',
      view({ ...frozen, authors: [USER] }),
      true,
    ],
    ['frozen: edit_all_contest yes', 'editAll', view(frozen), true],
    [
      'hidden scoreboard, ended: no',
      'plain',
      view({
        scoreboardVisibility: 'H',
        startTime: hours(-5),
        endTime: hours(-1),
      }),
      false,
    ],
  ])('%s', (_case, who, contest, expected) =>
    expect(
      ContestAccess.canSeeFullSubmissionList(
        PRINCIPALS[who],
        contest,
        NOW,
        NO_FACTS,
      ),
    ).toBe(expected),
  );
});
