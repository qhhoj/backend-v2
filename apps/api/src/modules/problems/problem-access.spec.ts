import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  optionalPrincipal,
  type AuthContext,
  type Permission,
  type Principal,
} from '@libs/auth';
import { DatabaseModule, newId, Problem, toUuid } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { Model } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ProblemAccess, ProblemAccessView } from './problem-access';

const USER = newId();
const OTHER = newId();
const ORG = newId();
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
  overrides: Partial<ProblemAccessView> = {},
): ProblemAccessView => ({
  isPublic: true,
  isOrganizationPrivate: false,
  organizations: [],
  authors: [],
  curators: [],
  testers: [],
  suggester: null,
  ...overrides,
});

const PRINCIPALS: Record<string, Principal | null> = {
  anonymous: null,
  plain: principalWith(),
  orgMember: principalWith({ organizationIds: [ORG] }),
  seePrivate: principalWith({}, 'judge.see_private_problem'),
  seeOrg: principalWith({}, 'judge.see_organization_problem'),
  editOwn: principalWith({}, 'judge.edit_own_problem'),
  editAll: principalWith(
    {},
    'judge.edit_own_problem',
    'judge.edit_all_problem',
  ),
  editPublic: principalWith(
    {},
    'judge.edit_own_problem',
    'judge.edit_public_problem',
  ),
  editPublicWithoutOwn: principalWith({}, 'judge.edit_public_problem'),
  suggester: principalWith({}, 'judge.suggest_new_problem'),
  suggesterEditor: principalWith(
    {},
    'judge.edit_own_problem',
    'judge.suggest_new_problem',
  ),
  superuser: principalWith({ isSuperuser: true }),
};

describe('ProblemAccess.canSee', () => {
  it.each([
    ['anonymous sees public', 'anonymous', view(), true],
    [
      'anonymous does not see private',
      'anonymous',
      view({ isPublic: false }),
      false,
    ],
    [
      'anonymous does not see org-private',
      'anonymous',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      false,
    ],
    ['plain user sees public', 'plain', view(), true],
    [
      'plain user does not see org-private',
      'plain',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      false,
    ],
    [
      'org member sees own org problem',
      'orgMember',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      true,
    ],
    [
      'see_organization_problem sees any org problem',
      'seeOrg',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      true,
    ],
    [
      'see_private_problem sees private',
      'seePrivate',
      view({ isPublic: false }),
      true,
    ],
    [
      'author sees private',
      'plain',
      view({ isPublic: false, authors: [USER] }),
      true,
    ],
    [
      'curator sees private',
      'plain',
      view({ isPublic: false, curators: [USER] }),
      true,
    ],
    [
      'tester sees private',
      'plain',
      view({ isPublic: false, testers: [USER] }),
      true,
    ],
    [
      'suggester sees own suggestion',
      'plain',
      view({ isPublic: false, suggester: USER }),
      true,
    ],
    [
      'other author does not grant',
      'plain',
      view({ isPublic: false, authors: [OTHER] }),
      false,
    ],
    [
      'suggest_new_problem sees any suggestion',
      'suggester',
      view({ isPublic: false, suggester: OTHER }),
      true,
    ],
    [
      'suggest_new_problem does not see plain private',
      'suggester',
      view({ isPublic: false }),
      false,
    ],
    ['edit_all sees private', 'editAll', view({ isPublic: false }), true],
    [
      'edit_public sees org-private public',
      'editPublic',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      true,
    ],
    [
      'edit_public without edit_own does not',
      'editPublicWithoutOwn',
      view({ isOrganizationPrivate: true, organizations: [ORG] }),
      false,
    ],
    [
      'edit_public does not see an uneditable private problem',
      'editPublic',
      view({ isPublic: false }),
      false,
    ],
    ['superuser sees everything', 'superuser', view({ isPublic: false }), true],
  ])('%s', (_name, who, problem, expected) =>
    expect(ProblemAccess.canSee(PRINCIPALS[who], problem)).toBe(expected),
  );
});

describe('ProblemAccess.canEdit', () => {
  it.each([
    ['anonymous', 'anonymous', view({ authors: [USER] }), false],
    [
      'author without edit_own_problem',
      'plain',
      view({ authors: [USER] }),
      false,
    ],
    [
      'author with edit_own_problem',
      'editOwn',
      view({ authors: [USER] }),
      true,
    ],
    [
      'curator with edit_own_problem',
      'editOwn',
      view({ curators: [USER] }),
      true,
    ],
    ['tester never edits', 'editOwn', view({ testers: [USER] }), false],
    [
      'suggester edits own suggestion',
      'editOwn',
      view({ isPublic: false, suggester: USER }),
      true,
    ],
    [
      'suggest_new_problem alone does not edit',
      'suggester',
      view({ isPublic: false, suggester: OTHER }),
      false,
    ],
    [
      'suggest_new_problem + edit_own edits suggestions',
      'suggesterEditor',
      view({ isPublic: false, suggester: OTHER }),
      true,
    ],
    ['edit_public edits public only', 'editPublic', view(), true],
    [
      'edit_public does not edit private',
      'editPublic',
      view({ isPublic: false }),
      false,
    ],
    ['edit_all edits anything', 'editAll', view({ isPublic: false }), true],
    ['superuser', 'superuser', view({ isPublic: false }), true],
  ])('%s', (_name, who, problem, expected) =>
    expect(ProblemAccess.canEdit(PRINCIPALS[who], problem)).toBe(expected),
  );
});

describe('ProblemAccess.visibleFilter', () => {
  let replSet: MongoMemoryReplSet,
    testingModule: TestingModule,
    problems: Model<Problem>;
  const generated: Array<{ code: string; view: ProblemAccessView }> = [];

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    problems = testingModule.get(getModelToken(Problem.name));
    const roles: Array<Partial<ProblemAccessView>> = [
      {},
      { authors: [USER] },
      { curators: [USER] },
      { testers: [USER] },
      { suggester: USER },
      { suggester: OTHER },
      { authors: [OTHER] },
      { authors: [OTHER], testers: [USER] },
      { curators: [OTHER], suggester: OTHER },
    ];
    let index = 0;
    for (const isPublic of [true, false])
      for (const isOrganizationPrivate of [true, false])
        for (const organizations of [[ORG], [newId()], []])
          for (const role of roles) {
            const problemView = view({
              isPublic,
              isOrganizationPrivate,
              organizations,
              ...role,
            });
            const code = `p${index++}`;
            generated.push({ code, view: problemView });
            await problems.create({
              ...problemView,
              code,
              name: code,
              timeLimit: 1,
              memoryLimit: 1,
              points: 1000,
              typeIds: [newId()],
              groupId: newId(),
            });
          }
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it('accessView of every stored document (hydrated and lean) equals the generated view', async () => {
    for (const { code, view: expectedView } of generated) {
      const hydrated = await problems.findOne({ code });
      expect(ProblemAccess.accessView(hydrated!)).toEqual(expectedView);
      const lean = await problems.findOne({ code }).lean();
      expect(ProblemAccess.accessView(lean!)).toEqual(expectedView);
    }
  });

  const RELEVANT_PERMISSIONS: Permission[] = [
    'judge.see_private_problem',
    'judge.see_organization_problem',
    'judge.edit_own_problem',
    'judge.edit_all_problem',
    'judge.edit_public_problem',
    'judge.suggest_new_problem',
  ];
  const EXHAUSTIVE: Array<[string, Principal]> = [];
  for (let mask = 0; mask < 1 << RELEVANT_PERMISSIONS.length; mask++)
    for (const organizationIds of [[], [ORG]])
      EXHAUSTIVE.push([
        `mask ${mask} orgs ${organizationIds.length}`,
        principalWith(
          { organizationIds },
          ...RELEVANT_PERMISSIONS.filter(
            (_permission, bit) => mask & (1 << bit),
          ),
        ),
      ]);

  it.each([
    ...Object.entries(PRINCIPALS).map(
      ([who, principal]) => [who, principal] as [string, Principal | null],
    ),
    ...EXHAUSTIVE,
  ])('matches canSee for %s', async (_who, principal) => {
    const expected = generated
      .filter(({ view: problemView }) =>
        ProblemAccess.canSee(principal, problemView),
      )
      .map(({ code }) => code)
      .sort();
    const actual = (
      await problems
        .find({
          $and: [
            { code: { $in: generated.map(({ code }) => code) } },
            ProblemAccess.visibleFilter(principal),
          ],
        })
        .lean()
    )
      .map((problem) => problem.code)
      .sort();
    expect(actual).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('treats a raw document lacking suggester and arrays as having none', async () => {
    await problems.db
      .collection<{
        _id: ReturnType<typeof toUuid>;
        code: string;
        name: string;
        isPublic: boolean;
        isOrganizationPrivate: boolean;
      }>('problems')
      .insertOne({
        _id: toUuid(newId()),
        code: 'rawdoc',
        name: 'rawdoc',
        isPublic: false,
        isOrganizationPrivate: false,
      });
    try {
      const lean = (await problems.findOne({ code: 'rawdoc' }).lean())!;
      const problemView = ProblemAccess.accessView(lean);
      expect(problemView).toEqual(view({ isPublic: false }));
      for (const principal of Object.values(PRINCIPALS)) {
        const visible =
          (
            await problems
              .find({
                $and: [
                  { code: 'rawdoc' },
                  ProblemAccess.visibleFilter(principal),
                ],
              })
              .lean()
          ).length === 1;
        expect(visible).toBe(ProblemAccess.canSee(principal, problemView));
      }
    } finally {
      await problems.deleteOne({ code: 'rawdoc' });
    }
  });
});

describe('optionalPrincipal', () => {
  const principal = principalWith();
  const authWith = (session: object | null) =>
    ({ principal, session }) as unknown as AuthContext;
  it.each([
    ['no auth', undefined, null],
    ['token auth (no session)', authWith(null), principal],
    [
      'fully verified session',
      authWith({ twoFaPassed: true, passwordPwned: false }),
      principal,
    ],
    [
      '2FA pending',
      authWith({ twoFaPassed: false, passwordPwned: false }),
      null,
    ],
    [
      'pwned password',
      authWith({ twoFaPassed: true, passwordPwned: true }),
      null,
    ],
  ])('%s', (_name, auth, expected) =>
    expect(optionalPrincipal(auth)).toBe(expected),
  );
});
