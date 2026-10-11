import type { Principal } from '@libs/auth';
import type { SubmissionCase } from '@libs/database';
import {
  batchSummaries,
  caseVisibility,
  detailAccess,
  staffOnlyFilter,
  submissionActions,
} from './submission-access';
import type {
  SubmissionActionFacts,
  SubmissionProblemView,
} from './submission-access';

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
    {
      label: 'the owner',
      principal: viewer({ userId: 'owner' }),
      view: problem({ submissionSourceVisibility: 'O' }),
      canEdit: false,
      expected: 'granted',
    },
    {
      label: 'an editor',
      principal: viewer(),
      view: problem({ submissionSourceVisibility: 'O' }),
      canEdit: true,
      expected: 'granted',
    },
    {
      label: 'a reviewer of a suggested problem',
      principal: viewer({
        permissions: new Set(['judge.suggest_new_problem']),
      }),
      view: problem({
        isPublic: false,
        suggester: 'someone',
        submissionSourceVisibility: 'O',
      }),
      canEdit: false,
      expected: 'granted',
    },
    {
      label: 'a reviewer of a public problem that has a suggester',
      principal: viewer({
        permissions: new Set(['judge.suggest_new_problem']),
      }),
      view: problem({ suggester: 'someone', submissionSourceVisibility: 'O' }),
      canEdit: false,
      expected: 'denied',
    },
    {
      label: 'anyone who solved it when S',
      principal: viewer(),
      view: problem({ submissionSourceVisibility: 'S' }),
      canEdit: false,
      expected: 'if-solved',
    },
    {
      label: 'nobody on a private problem when S',
      principal: viewer(),
      view: problem({ isPublic: false, submissionSourceVisibility: 'S' }),
      canEdit: false,
      expected: 'denied',
    },
    {
      label: 'a tester of a private problem when S',
      principal: viewer(),
      view: problem({
        isPublic: false,
        testers: ['viewer'],
        submissionSourceVisibility: 'S',
      }),
      canEdit: false,
      expected: 'if-solved',
    },
    {
      label: 'anyone else when O',
      principal: viewer(),
      view: problem({ submissionSourceVisibility: 'O' }),
      canEdit: false,
      expected: 'denied',
    },
  ])('$label → $expected', ({ principal, view, canEdit, expected }) =>
    expect(
      detailAccess(principal, {
        ownerId: 'owner',
        problem: view,
        canEdit,
        isContestEditor: false,
      }),
    ).toBe(expected),
  );

  it('grants contest editors any submission of their contest', () =>
    expect(
      detailAccess(viewer(), {
        ownerId: 'owner',
        problem: problem({ submissionSourceVisibility: 'O' }),
        canEdit: false,
        isContestEditor: true,
      }),
    ).toBe('granted'));
});

describe('caseVisibility', () => {
  const shown = {
    testcaseResultVisibility: 'A',
    testcaseVisibility: 'O',
    allowViewFeedback: false,
  };
  it('shows cases, batches or nothing by testcaseResultVisibility, everything to superusers', () => {
    expect(
      caseVisibility(viewer(), shown, { canEdit: false, isInContest: false })
        .cases,
    ).toBe('all');
    expect(
      caseVisibility(
        viewer(),
        { ...shown, testcaseResultVisibility: 'B' },
        { canEdit: false, isInContest: false },
      ).cases,
    ).toBe('batches');
    expect(
      caseVisibility(
        viewer(),
        { ...shown, testcaseResultVisibility: 'S' },
        { canEdit: false, isInContest: false },
      ).cases,
    ).toBe('none');
    expect(
      caseVisibility(
        viewer({ isSuperuser: true }),
        { ...shown, testcaseResultVisibility: 'S' },
        { canEdit: false, isInContest: false },
      ).cases,
    ).toBe('all');
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
          { canEdit, isInContest: inContest },
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

const NOW = new Date('2026-10-09T12:00:00Z');
const withPermissions = (...permissions: string[]): Principal =>
  viewer({ permissions: new Set(permissions) });
const actionFacts = (
  extra: Partial<SubmissionActionFacts> = {},
): SubmissionActionFacts => ({
  isOwner: false,
  status: 'D',
  rejudgedDate: null,
  lockedAfter: null,
  canEditProblem: false,
  ...extra,
});
const EDITOR_PERMISSIONS = [
  'judge.rejudge_submission',
  'judge.reject_submission',
];

describe('submissionActions', () => {
  it.each([
    {
      label: 'the owner of an unfinished submission may abort it',
      principal: viewer({ userId: 'owner' }),
      facts: actionFacts({ isOwner: true, status: 'QU' }),
      expected: { canAbort: true, canRejudge: false, canReject: false },
    },
    {
      label: 'the owner loses abort once an admin rejudged it',
      principal: viewer({ userId: 'owner' }),
      facts: actionFacts({
        isOwner: true,
        status: 'QU',
        rejudgedDate: NOW,
      }),
      expected: { canAbort: false, canRejudge: false, canReject: false },
    },
    {
      label:
        "judge.abort_any_submission aborts someone else's running submission",
      principal: withPermissions('judge.abort_any_submission'),
      facts: actionFacts({ status: 'G' }),
      expected: { canAbort: true, canRejudge: false, canReject: false },
    },
    {
      label:
        'an editor with the permissions may rejudge and reject a finished submission',
      principal: withPermissions(...EDITOR_PERMISSIONS),
      facts: actionFacts({ canEditProblem: true }),
      expected: { canAbort: false, canRejudge: true, canReject: true },
    },
    {
      label:
        'a locked submission cannot be rejudged, but can still be rejected',
      principal: withPermissions(...EDITOR_PERMISSIONS),
      facts: actionFacts({
        canEditProblem: true,
        lockedAfter: new Date('2026-10-08T12:00:00Z'),
      }),
      expected: { canAbort: false, canRejudge: false, canReject: true },
    },
    {
      label: 'a pending final-submission row can be rejected, not rejudged',
      principal: withPermissions(...EDITOR_PERMISSIONS),
      facts: actionFacts({ canEditProblem: true, status: 'PD' }),
      expected: { canAbort: false, canRejudge: false, canReject: true },
    },
    {
      label: 'a submission a judge holds can neither be rejudged nor rejected',
      principal: withPermissions(...EDITOR_PERMISSIONS),
      facts: actionFacts({ canEditProblem: true, status: 'P' }),
      expected: { canAbort: false, canRejudge: false, canReject: false },
    },
    {
      label:
        'the owner aborts without any permission; rejudge and reject still need theirs despite edit rights',
      principal: viewer({ userId: 'owner' }),
      facts: actionFacts({ canEditProblem: true, status: 'QU', isOwner: true }),
      expected: { canAbort: true, canRejudge: false, canReject: false },
    },
    {
      label: 'holding the permissions without edit rights allows nothing',
      principal: withPermissions(...EDITOR_PERMISSIONS),
      facts: actionFacts({ canEditProblem: false, status: 'D' }),
      expected: { canAbort: false, canRejudge: false, canReject: false },
    },
  ])('$label', ({ principal, facts, expected }) => {
    expect(submissionActions(principal, facts, NOW)).toEqual(expected);
  });
});
