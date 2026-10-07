import type { Principal } from '@libs/auth';
import type { SubmissionCase } from '@libs/database';
import {
  batchSummaries,
  caseVisibility,
  detailAccess,
  staffOnlyFilter,
} from './submission-access';
import type { SubmissionProblemView } from './submission-access';

const viewer = (extra: Partial<Principal> = {}): Principal => ({
  userId: 'viewer',
  username: 'viewer',
  isSuperuser: false,
  isStaff: false,
  permissions: new Set<string>(),
  organizationIds: [],
  ...extra,
});
const problem = (
  extra: Partial<SubmissionProblemView> = {},
): SubmissionProblemView => ({
  id: 'p-own',
  isPublic: true,
  isOrganizationPrivate: false,
  organizations: [],
  authors: [],
  curators: [],
  testers: [],
  suggester: null,
  submissionSourceVisibility: 'F',
  ...extra,
});
const testCase = (
  position: number,
  extra: Partial<SubmissionCase> = {},
): SubmissionCase => ({
  position,
  status: 'AC',
  time: 0,
  memory: 0,
  points: 1,
  total: 1,
  batch: null,
  feedback: '',
  extendedFeedback: '',
  output: '',
  ...extra,
});

describe('detailAccess', () => {
  it.each([
    [
      'the owner',
      viewer({ userId: 'owner' }),
      problem({ submissionSourceVisibility: 'O' }),
      false,
      'granted',
    ],
    [
      'an editor',
      viewer(),
      problem({ submissionSourceVisibility: 'O' }),
      true,
      'granted',
    ],
    [
      'judge.view_all_submission',
      viewer({ permissions: new Set(['judge.view_all_submission']) }),
      problem({ submissionSourceVisibility: 'O' }),
      false,
      'granted',
    ],
    [
      'a superuser',
      viewer({ isSuperuser: true }),
      problem({ submissionSourceVisibility: 'O' }),
      false,
      'granted',
    ],
    [
      'a reviewer of a suggested problem',
      viewer({ permissions: new Set(['judge.suggest_new_problem']) }),
      problem({
        isPublic: false,
        suggester: 'someone',
        submissionSourceVisibility: 'O',
      }),
      false,
      'granted',
    ],
    [
      'a reviewer of a public problem that has a suggester',
      viewer({ permissions: new Set(['judge.suggest_new_problem']) }),
      problem({ suggester: 'someone', submissionSourceVisibility: 'O' }),
      false,
      'denied',
    ],
    [
      'anyone when A',
      viewer(),
      problem({ submissionSourceVisibility: 'A' }),
      false,
      'granted',
    ],
    [
      'anyone who solved it when S',
      viewer(),
      problem({ submissionSourceVisibility: 'S' }),
      false,
      'if-solved',
    ],
    [
      'F, following the site default all-solved',
      viewer(),
      problem(),
      false,
      'if-solved',
    ],
    [
      'nobody on a private problem when S',
      viewer(),
      problem({ isPublic: false, submissionSourceVisibility: 'S' }),
      false,
      'denied',
    ],
    [
      'a tester of a private problem when S',
      viewer(),
      problem({
        isPublic: false,
        testers: ['viewer'],
        submissionSourceVisibility: 'S',
      }),
      false,
      'if-solved',
    ],
    [
      'a tester when O',
      viewer(),
      problem({ testers: ['viewer'], submissionSourceVisibility: 'O' }),
      false,
      'granted',
    ],
    [
      'anyone else when O',
      viewer(),
      problem({ submissionSourceVisibility: 'O' }),
      false,
      'denied',
    ],
  ] as const)('%s → %s', (_label, principal, view, canEdit, expected) =>
    expect(detailAccess(principal, 'owner', view, canEdit, false)).toBe(
      expected,
    ),
  );

  it('grants contest editors any submission of their contest', () =>
    expect(
      detailAccess(
        viewer(),
        'owner',
        problem({ submissionSourceVisibility: 'O' }),
        false,
        true,
      ),
    ).toBe('granted'));
});

describe('caseVisibility', () => {
  const shown = {
    testcaseResultVisibility: 'A',
    testcaseVisibility: 'O',
    allowViewFeedback: false,
  };
  it('shows cases, batches or nothing by testcaseResultVisibility, everything to superusers', () => {
    expect(caseVisibility(viewer(), shown, false, false).cases).toBe('all');
    expect(
      caseVisibility(
        viewer(),
        { ...shown, testcaseResultVisibility: 'B' },
        false,
        false,
      ).cases,
    ).toBe('batches');
    expect(
      caseVisibility(
        viewer(),
        { ...shown, testcaseResultVisibility: 'S' },
        false,
        false,
      ).cases,
    ).toBe('none');
    expect(
      caseVisibility(
        viewer({ isSuperuser: true }),
        { ...shown, testcaseResultVisibility: 'S' },
        false,
        false,
      ).cases,
    ).toBe('all');
  });
  it('shows feedback to superusers, editors or when allowed', () => {
    expect(caseVisibility(viewer(), shown, false, false).feedback).toBe(false);
    expect(caseVisibility(viewer(), shown, true, false).feedback).toBe(true);
    expect(
      caseVisibility(viewer({ isSuperuser: true }), shown, false, false)
        .feedback,
    ).toBe(true);
    expect(
      caseVisibility(
        viewer(),
        { ...shown, allowViewFeedback: true },
        false,
        false,
      ).feedback,
    ).toBe(true);
  });
  it.each([
    ['A', false, false, true],
    ['C', false, false, true],
    ['O', false, false, false],
    ['O', true, false, true],
    ['A', false, true, true],
    ['C', false, true, false],
    ['C', true, true, true],
    ['O', false, true, false],
  ])(
    'testcaseVisibility %s, editor %s, in a contest %s: output shown %s',
    (testcaseVisibility, canEdit, inContest, expected) =>
      expect(
        caseVisibility(
          viewer(),
          { ...shown, testcaseVisibility },
          canEdit,
          inContest,
        ).output,
      ).toBe(expected),
  );
});

describe('batchSummaries', () => {
  it('takes per batch the smallest points, the largest total and the first non-AC status', () =>
    expect(
      batchSummaries([
        testCase(1),
        testCase(2, { batch: 1, points: 2, total: 2 }),
        testCase(3, { batch: 1, status: 'TLE', points: 0, total: 3 }),
        testCase(4, { batch: 1, status: 'WA', points: 0, total: 3 }),
        testCase(5, { batch: 2 }),
      ]),
    ).toEqual([
      { batch: 1, status: 'TLE', points: 0, total: 3 },
      { batch: 2, status: 'AC', points: 1, total: 1 },
    ]));
});

describe('staffOnlyFilter', () => {
  it('names the field holding a staff-only code for everyone but staff', () => {
    expect(staffOnlyFilter(null, { result: ['AC', 'SC'] })).toBe('result');
    expect(staffOnlyFilter(viewer(), { result: ['WA'], status: ['QU'] })).toBe(
      'status',
    );
    expect(
      staffOnlyFilter(viewer(), { result: ['AC', 'RJ'], status: ['CE', 'AB'] }),
    ).toBeNull();
    expect(
      staffOnlyFilter(viewer({ isStaff: true }), { status: ['IE', 'G'] }),
    ).toBeNull();
    expect(
      staffOnlyFilter(viewer({ isSuperuser: true }), { result: ['SC'] }),
    ).toBeNull();
  });
});
