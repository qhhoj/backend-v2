import type { Principal } from '@libs/auth';
import { mayRunBatch, rejudgeFilter } from './batch-filter';
import type { BatchScope } from './batch-filter';

const staff = (...permissions: string[]): Principal => ({
  userId: 'staff',
  username: 'staff',
  isSuperuser: false,
  isStaff: true,
  permissions: new Set(permissions),
  organizationIds: [],
});
const REJUDGE = 'judge.rejudge_submission';
const NOW = new Date('2026-10-11T00:00:00Z');

describe('mayRunBatch', () => {
  it.each<{ label: string; who: Principal; scope: BatchScope; ok: boolean }>([
    {
      label: 'an editor of the problem with the permission',
      who: staff(REJUDGE),
      scope: { kind: 'problem', canEdit: true },
      ok: true,
    },
    {
      label: 'an editor of the contest with the permission',
      who: staff(REJUDGE),
      scope: { kind: 'contest', canEdit: true },
      ok: true,
    },
    {
      label: 'edit rights without judge.rejudge_submission',
      who: staff('judge.edit_all_problem'),
      scope: { kind: 'problem', canEdit: true },
      ok: false,
    },
    {
      label: 'the permission without edit rights on the contest',
      who: staff(REJUDGE, 'judge.edit_all_problem'),
      scope: { kind: 'contest', canEdit: false },
      ok: false,
    },
    {
      label: 'a site-wide batch without judge.edit_all_problem',
      who: staff(REJUDGE, 'judge.edit_all_contest'),
      scope: { kind: 'site' },
      ok: false,
    },
    {
      label: 'a site-wide batch with judge.edit_all_problem',
      who: staff(REJUDGE, 'judge.edit_all_problem'),
      scope: { kind: 'site' },
      ok: true,
    },
  ])('$label: $ok', ({ who, scope, ok }) => {
    expect(mayRunBatch(who, scope)).toBe(ok);
  });
});

describe('rejudgeFilter', () => {
  it('never resets rows a judge holds or pending final rows, and skips locked rows unless forced', () => {
    expect(rejudgeFilter({}, {}, NOW)).toEqual({
      status: { $nin: ['P', 'G', 'PD'] },
      $or: [{ lockedAfter: null }, { lockedAfter: { $gte: NOW } }],
    });
    expect(rejudgeFilter({}, { force: true }, NOW)).toEqual({
      status: { $nin: ['P', 'G', 'PD'] },
    });
  });

  it('narrows a selection of ids by the id range instead of replacing it', () => {
    const filter = rejudgeFilter(
      {},
      { ids: ['a', 'b'], idFrom: 'a', force: true },
      NOW,
    );
    expect(filter._id).toEqual({ $in: ['a', 'b'], $gte: 'a' });
  });

  it('leaves out deleted problems when no problem is named', () => {
    expect(
      rejudgeFilter({ deletedProblemIds: ['gone'] }, { force: true }, NOW),
    ).toMatchObject({ problem: { $nin: ['gone'] } });
  });

  it('turns the date range into a half-open range on the submit time', () => {
    const filter = rejudgeFilter(
      { contestId: 'c' },
      { dateFrom: '2026-10-01T00:00:00Z', dateTo: '2026-10-02T00:00:00Z' },
      NOW,
    );
    expect(filter).toMatchObject({
      contest: 'c',
      date: {
        $gte: new Date('2026-10-01T00:00:00Z'),
        $lt: new Date('2026-10-02T00:00:00Z'),
      },
    });
  });
});
