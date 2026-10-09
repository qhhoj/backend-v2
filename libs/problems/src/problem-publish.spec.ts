import type { Principal } from '@libs/auth';
import { newId } from '@libs/database';
import type { Problem } from '@libs/database';
import {
  isEditorialReleased,
  mayPublish,
  publishVerdict,
} from './problem-publish';

const principal = (
  permissions: string[],
  extra: Partial<Principal> = {},
): Principal => ({
  userId: newId(),
  username: 'u',
  isSuperuser: false,
  isStaff: false,
  permissions: new Set(permissions),
  organizationIds: [],
  ...extra,
});

const problem = (extra: Partial<Problem> = {}): Problem =>
  ({
    _id: newId(),
    isPublic: false,
    isOrganizationPrivate: false,
    organizations: [],
    authors: [],
    curators: [],
    testers: [],
    suggester: null,
    ...extra,
  }) as Problem;

describe('publishVerdict', () => {
  const rights = ['judge.edit_own_problem', 'judge.change_public_visibility'];

  it('skips a deleted problem, before anything else about it', () => {
    const actor = principal(rights, { isSuperuser: true });
    expect(
      publishVerdict(actor, problem({ isPublic: true, deletedAt: new Date() })),
    ).toEqual({ outcome: 'skipped', reason: 'deleted' });
  });

  it('publishes a private problem the actor edits when they may change visibility', () => {
    const actor = principal(rights);
    expect(publishVerdict(actor, problem({ authors: [actor.userId] }))).toEqual(
      { outcome: 'published', reason: null },
    );
  });

  it('skips without change_public_visibility even for an author', () => {
    const actor = principal(['judge.edit_own_problem']);
    expect(publishVerdict(actor, problem({ authors: [actor.userId] }))).toEqual(
      { outcome: 'skipped', reason: 'no_permission' },
    );
  });

  it('skips a problem the actor cannot edit', () => {
    expect(publishVerdict(principal(rights), problem())).toEqual({
      outcome: 'skipped',
      reason: 'no_permission',
    });
  });

  it('skips an organization-private problem and leaves a public one unchanged', () => {
    const actor = principal(rights, { isSuperuser: true });
    expect(
      publishVerdict(actor, problem({ isOrganizationPrivate: true })),
    ).toEqual({ outcome: 'skipped', reason: 'organization_private' });
    expect(publishVerdict(actor, problem({ isPublic: true }))).toEqual({
      outcome: 'unchanged',
      reason: null,
    });
  });

  it('reports a missing problem as not found', () => {
    expect(publishVerdict(principal(rights), null)).toEqual({
      outcome: 'skipped',
      reason: 'not_found',
    });
  });

  it('lets a superuser publish and a plain user not', () => {
    expect(mayPublish(principal([], { isSuperuser: true }), problem())).toBe(
      true,
    );
    expect(mayPublish(principal([]), problem())).toBe(false);
  });
});

describe('isEditorialReleased', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const solution = (isPublic: boolean, publishOn: string) =>
    ({ isPublic, publishOn: new Date(publishOn) }) as NonNullable<
      Problem['solution']
    >;

  it('is released only when public and its publish time has come', () => {
    expect(
      isEditorialReleased(solution(true, '2026-10-09T11:00:00Z'), now),
    ).toBe(true);
    expect(
      isEditorialReleased(solution(true, '2026-10-10T00:00:00Z'), now),
    ).toBe(false);
    expect(
      isEditorialReleased(solution(false, '2026-10-09T11:00:00Z'), now),
    ).toBe(false);
    expect(isEditorialReleased(null, now)).toBe(false);
  });

  it('treats a missing solution field on a lean document as not released', () => {
    expect(
      isEditorialReleased(undefined as unknown as Problem['solution'], now),
    ).toBe(false);
  });
});
