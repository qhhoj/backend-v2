import { optionalPrincipal, type AuthContext } from '@libs/auth';
import {
  ORG,
  OTHER,
  PRINCIPALS,
  USER,
  principalWith,
  view,
} from '../../../../test/problem-access-fixtures';
import { ProblemAccess, type ContestScope } from './problem-access';

describe('ProblemAccess.canSee', () => {
  it.each([
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
      'suggester sees own suggestion',
      'plain',
      view({ isPublic: false, suggester: USER }),
      true,
    ],
    [
      'suggest_new_problem sees any suggestion',
      'suggester',
      view({ isPublic: false, suggester: OTHER }),
      true,
    ],
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
    expect(ProblemAccess.canSee(PRINCIPALS[who], problem, null)).toBe(expected),
  );
});

describe('ProblemAccess.canEdit', () => {
  it.each([
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
      "suggest_new_problem + edit_own never edits another's suggestion",
      'suggesterEditor',
      view({ isPublic: false, suggester: OTHER }),
      false,
    ],
  ])('%s', (_name, who, problem, expected) =>
    expect(ProblemAccess.canEdit(PRINCIPALS[who], problem)).toBe(expected),
  );
});

describe('ProblemAccess with a current contest (legacy is_accessible_by step 1)', () => {
  const started: ContestScope = {
    contestId: 'c-current',
    started: true,
    problemIds: ['p-contest'],
  };
  const notStarted: ContestScope = {
    contestId: 'c-current',
    started: false,
    problemIds: ['p-contest'],
  };
  it.each([
    [
      "shows the contest's private problem",
      started,
      view({ id: 'p-contest', isPublic: false }),
      true,
    ],
    [
      "never shows another contest's private problem",
      started,
      view({ id: 'p-other', isPublic: false }),
      false,
    ],
    [
      'hides every problem before the contest starts',
      notStarted,
      view({ id: 'p-public' }),
      false,
    ],
  ])('%s', (_case, scope, problem, expected) =>
    expect(ProblemAccess.canSee(PRINCIPALS.plain, problem, scope)).toBe(
      expected,
    ),
  );
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
