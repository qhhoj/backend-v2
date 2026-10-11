import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Permission, Principal } from '@libs/auth';
import { Contest, DatabaseModule, newId } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { Model } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ContestAccess, NO_FACTS } from './contest-access';
import type { ContestAccessView } from './contest-access';

const USER = newId();
const OTHER = newId();
const ORG = newId();
const NOW = new Date('2026-05-01T12:00:00Z');
const hours = (count: number) => new Date(NOW.getTime() + count * 3_600_000);
const principalWith = (
  overrides: Partial<Principal> = {},
  ...permissions: Permission[]
): Principal => ({
  userId: USER,
  username: 'user',
  isSuperuser: false,
  isStaff: false,
  permissions: new Set(permissions),
  organizationIds: [],
  ...overrides,
});
const view = (
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
  startTime: hours(-1),
  endTime: hours(2),
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'default',
  ...overrides,
});

const PRINCIPALS: Record<string, Principal | null> = {
  anonymous: null,
  plain: principalWith(),
  member: principalWith({ organizationIds: [ORG] }),
  seePrivate: principalWith({}, 'judge.see_private_contest'),
  editAll: principalWith({}, 'judge.edit_all_contest'),
  editOwn: principalWith({}, 'judge.edit_own_contest'),
  superuser: principalWith({ isSuperuser: true }),
};

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

describe('ContestAccess.visibleFilter', () => {
  let replSet: MongoMemoryReplSet;
  let testingModule: TestingModule;
  let contests: Model<Contest>;
  const generated: Array<{ key: string; view: ContestAccessView }> = [];
  const documents: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    contests = testingModule.get(getModelToken(Contest.name));
    const roles: Array<Partial<ContestAccessView>> = [
      {},
      { authors: [USER] },
      { curators: [USER] },
      { testers: [USER] },
      { privateContestants: [USER] },
      { privateContestants: [OTHER] },
      { viewContestScoreboard: [USER] },
      { balloonStaff: [USER] },
      { authors: [OTHER] },
    ];
    let index = 0;
    for (const isVisible of [true, false])
      for (const isPrivate of [true, false])
        for (const isOrganizationPrivate of [true, false])
          for (const organizations of [[ORG], [newId()]])
            for (const role of roles) {
              const contestView = view({
                isVisible,
                isPrivate,
                isOrganizationPrivate,
                organizations,
                ...role,
              });
              const key = `c${index++}`;
              generated.push({ key, view: contestView });
              documents.push({ ...contestView, key, name: key });
            }
    await contests.insertMany(documents);
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it.each(Object.keys(PRINCIPALS))(
    'matches exactly what canSee allows for %s',
    async (who) => {
      const principal = PRINCIPALS[who];
      const expected = generated
        .filter(({ view: contestView }) =>
          ContestAccess.canSee(principal, contestView),
        )
        .map(({ key }) => key)
        .sort();
      const actual = (
        await contests
          .find({
            $and: [
              { key: { $in: generated.map(({ key }) => key) } },
              ContestAccess.visibleFilter(principal),
            ],
          })
          .lean()
      )
        .map((contest) => contest.key)
        .sort();
      expect(actual).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    },
  );
});
